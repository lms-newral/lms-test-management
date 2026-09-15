/**
 * Live checks for the two access fixes from the audit, on the THROWAWAY database:
 *   1. a student keeps their results, and their series, after the series ends;
 *   2. an admin cannot remove a student who has already taken a test, and a
 *      student who somehow lost their enrollment can still reach their result.
 *
 *   node loadtest/verify-audit.js
 */
const { prisma, DB_URL } = require('./lib');
const { ExamResultService } = require('../dist/src/modules/exam/exam-result.service');
const { ExamAttemptsService } = require('../dist/src/modules/exam/exam-attempts.service');
const { StudentTestSeriesService } = require('../dist/src/modules/tests/student-test-series.service');
const { TestSeriesService } = require('../dist/src/modules/tests/test-series.service');

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) failures++;
};
const tryIt = async (fn) => {
  try {
    return { value: await fn(), error: null };
  } catch (e) {
    return { value: null, error: e };
  }
};

async function main() {
  if (/supabase|pooler/i.test(DB_URL)) throw new Error('Refusing: this script moves series dates.');
  const db = prisma();

  const attempt = await db.examAttempt.findFirst({
    where: { finalizedAt: { not: null }, seriesNodeId: { not: null }, seriesId: { not: null } },
    orderBy: { finalizedAt: 'desc' },
  });
  if (!attempt) throw new Error('No scored attempt in a series. Run loadtest/accuracy.js first.');
  const user = { userId: attempt.userId, tenantId: attempt.tenantId, email: 'loadtest@example.com' };
  const stranger = { userId: 'nobody-at-all', tenantId: attempt.tenantId, email: 'nobody@example.com' };

  const series = await db.testSeries.findUnique({ where: { id: attempt.seriesId } });
  const node = await db.testSeriesNode.findUnique({ where: { id: attempt.seriesNodeId } });
  const day = 86400_000;
  const now = Date.now();

  await db.testSeriesEnrollment.createMany({
    data: [{ tenantId: attempt.tenantId, seriesId: attempt.seriesId, userId: attempt.userId, userName: 'Load Student', userEmail: 'loadtest@example.com', source: 'FREE' }],
    skipDuplicates: true,
  });

  const attempts = new ExamAttemptsService(db, null, null, null, { get: () => 'loadtest-secret' });
  const results = new ExamResultService(db, attempts);
  const students = new StudentTestSeriesService(db, { getPresignedGetUrl: async () => 'https://example.com/cover' });
  const admin = new TestSeriesService(db, { getPresignedGetUrl: async () => 'https://example.com/cover' }, null);

  try {
    /* --- 1. The series has ended ------------------------------------------- */
    await db.testSeries.update({
      where: { id: series.id },
      data: { status: 'PUBLISHED', publishedAt: series.publishedAt ?? new Date(now - 40 * day), startAt: new Date(now - 30 * day), endAt: new Date(now - day) },
    });
    await db.testSeriesNode.update({
      where: { id: node.id },
      data: { availableFrom: new Date(now - 20 * day), availableTo: new Date(now - 10 * day), resultAt: new Date(now - 5 * day) },
    });

    const result = await tryIt(() => results.result(node.id, user));
    check('after the series ends, the student still gets their analysis', !!result.value, result.error?.message);
    const note = await tryIt(() => results.saveNote(node.id, 'Looking back after it ended.', user));
    check('and can still write their note', note.value?.note === 'Looking back after it ended.', note.error?.message);
    const mine = await tryIt(() => students.findOne(series.id, user));
    check('and can still open the series page', !!mine.value, mine.error?.message);
    const list = await tryIt(() => students.list(user, true));
    check('and still sees it under My test series', !!list.value?.some((s) => s.id === series.id), list.error?.message);
    const attemptStatus = mine.value?.nodes.find((n) => n.id === node.id)?.test?.attemptStatus;
    check('with the test still marked as attempted', attemptStatus === 'SUBMITTED', String(attemptStatus));

    const browse = await tryIt(() => students.list(stranger, false));
    check('an ended series is no longer on sale to others', !browse.value?.some((s) => s.id === series.id));
    const outsider = await tryIt(() => students.findOne(series.id, stranger));
    check('and someone not enrolled cannot open it', !!outsider.error, outsider.error ? outsider.error.message : 'it opened');
    const outsiderResult = await tryIt(() => results.result(node.id, stranger));
    check('nor reach a result that is not theirs', !!outsiderResult.error);

    /* --- 2. Removing a student who already has results --------------------- */
    const enrollment = await db.testSeriesEnrollment.findFirst({ where: { seriesId: series.id, userId: user.userId } });
    if (enrollment.source === 'PAID') await db.testSeriesEnrollment.update({ where: { id: enrollment.id }, data: { source: 'FREE' } });
    const removed = await tryIt(() => admin.removeStudent(enrollment.id, user.tenantId));
    check('an admin cannot remove a student who has taken a test', !!removed.error && /already taken/.test(removed.error.message), removed.error?.message ?? 'removed');
    check('and the enrollment is still there', !!(await db.testSeriesEnrollment.findUnique({ where: { id: enrollment.id } })));

    // If an enrollment disappears anyway (support fixed something by hand), the result must survive.
    await db.testSeriesEnrollment.delete({ where: { id: enrollment.id } });
    const orphan = await tryIt(() => results.result(node.id, user));
    check('a student with an attempt but no enrollment still reaches their result', !!orphan.value, orphan.error?.message);
    await db.testSeriesEnrollment.create({ data: { ...enrollment } });
  } finally {
    await db.testSeries.update({ where: { id: series.id }, data: { status: series.status, publishedAt: series.publishedAt, startAt: series.startAt, endAt: series.endAt } });
    await db.testSeriesNode.update({ where: { id: node.id }, data: { availableFrom: node.availableFrom, availableTo: node.availableTo, resultAt: node.resultAt } });
    await db.$disconnect();
  }

  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
