/**
 * Are the topper comparisons right?
 *
 * Runs the real analytics job on a test in the THROWAWAY database, then works
 * every stored cohort average out again in plain JavaScript from the rows — the
 * behaviour classes with the app's own classify(), not SQL — and compares.
 *
 *   node loadtest/verify-cohort.js [testId]
 */
const { prisma, DB_URL } = require('./lib');
const { AnalyticsComputeService } = require('../dist/src/modules/exam/analytics-compute.service');
const { classify } = require('../dist/src/modules/exam/analytics-behaviour.logic');

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) failures++;
};
const close = (a, b) => Math.abs(Number(a) - Number(b)) <= 0.011;

async function main() {
  if (/supabase|pooler/i.test(DB_URL)) throw new Error('Refusing: run this against the throwaway database.');
  const db = prisma();

  let testId = process.argv[2];
  if (!testId) {
    // A cohort big enough to compare, small enough to recompute in memory.
    const tests = await db.$queryRawUnsafe(
      `SELECT "testId", COUNT(*)::int AS n FROM "ExamAttempt"
        WHERE "finalizedAt" IS NOT NULL AND score IS NOT NULL
        GROUP BY "testId" HAVING COUNT(*) BETWEEN 10 AND 1000 ORDER BY n DESC LIMIT 1`,
    );
    testId = tests[0]?.testId;
  }
  if (!testId) throw new Error('No test with 10–1000 scored attempts. Run loadtest/accuracy.js 200 first.');

  const started = Date.now();
  await new AnalyticsComputeService(db).compute(testId);
  console.log(`Recomputed test ${testId} in ${Date.now() - started}ms\n`);

  const stored = (await db.testAnalytics.findUnique({ where: { testId } })).subjectStats;
  const attempts = await db.examAttempt.findMany({
    where: { testId, finalizedAt: { not: null }, score: { not: null } },
    select: { id: true, score: true },
  });
  const stats = new Map((await db.testQuestionStat.findMany({ where: { testId } })).map((s) => [s.questionId, s]));
  const rows = await db.examAttemptQuestion.findMany({
    where: { attemptId: { in: attempts.map((a) => a.id) } },
    select: { attemptId: true, questionId: true, subjectName: true, difficulty: true, result: true, marks: true, maxMarks: true, timeMs: true, visits: true },
  });

  // Competition rank, then the same cut the job uses.
  const scores = attempts.map((a) => a.score).sort((x, y) => y - x);
  const rankOf = (score) => scores.findIndex((s) => s <= score) + 1;
  const total = attempts.length;
  const inGroup = {
    all: () => true,
    top10: (a) => rankOf(a.score) <= Math.max(1, Math.ceil(total * 0.1)),
    top25: (a) => rankOf(a.score) <= Math.max(1, Math.ceil(total * 0.25)),
  };

  const byAttempt = new Map();
  for (const r of rows) {
    if (!r.subjectName) continue;
    const perSubject = byAttempt.get(r.attemptId) ?? new Map();
    const s = perSubject.get(r.subjectName) ?? { score: 0, maxMarks: 0, timeMs: 0, correct: 0, incorrect: 0, skipped: 0, notSeen: 0, timeCorrectMs: 0, timeWrongMs: 0, b: {}, levels: {} };
    s.score += r.marks;
    s.maxMarks += r.maxMarks ?? 0;
    s.timeMs += r.timeMs;
    const bucket = r.visits === 0 ? 'notSeen' : ['CORRECT', 'PARTIAL'].includes(r.result) ? 'correct' : r.result === 'INCORRECT' ? 'incorrect' : 'skipped';
    s[bucket]++;
    if (['CORRECT', 'PARTIAL'].includes(r.result)) s.timeCorrectMs += r.timeMs;
    if (r.result === 'INCORRECT') s.timeWrongMs += r.timeMs;
    const stat = stats.get(r.questionId);
    let b = classify(r, stat ? { attempts: stat.attempts, avgTimeMs: stat.avgTimeMs, avgTimeCorrectMs: stat.avgTimeCorrectMs } : null);
    if (b === 'NOT_SEEN') b = 'LEFT';
    s.b[b] = (s.b[b] ?? 0) + 1;
    if (r.difficulty) {
      const lv = (s.levels[r.difficulty] ??= { correct: 0, incorrect: 0, skipped: 0, notSeen: 0, total: 0 });
      lv[bucket]++;
      lv.total++;
    }
    perSubject.set(r.subjectName, s);
    byAttempt.set(r.attemptId, perSubject);
  }

  const fields = ['score', 'maxMarks', 'timeMs', 'correct', 'incorrect', 'skipped', 'notSeen', 'timeCorrectMs', 'timeWrongMs'];
  const behaviours = ['SOLID', 'SLOW', 'WASTED', 'RUSHED', 'STUCK', 'LEFT', 'UNCLASSIFIED'];
  const bad = { fields: [], behaviour: [], accuracy: [], difficulty: [], missing: [] };
  let classified = 0;

  for (const [group, member] of Object.entries(inGroup)) {
    const members = attempts.filter(member);
    const subjects = new Set(members.flatMap((a) => [...(byAttempt.get(a.id)?.keys() ?? [])]));
    for (const subject of subjects) {
      const got = stored[group]?.[subject];
      if (!got) {
        bad.missing.push(`${group}/${subject}`);
        continue;
      }
      const per = members.map((a) => byAttempt.get(a.id)?.get(subject)).filter(Boolean);
      const avg = (fn) => per.reduce((n, s) => n + fn(s), 0) / per.length;
      for (const f of fields) {
        const want = avg((s) => s[f]);
        const tolerance = f.endsWith('Ms') ? 1 : 0.011;
        if (Math.abs(got[f] - want) > tolerance) bad.fields.push(`${group}/${subject}/${f}: ${got[f]} vs ${want.toFixed(2)}`);
      }
      for (const b of behaviours) {
        const want = avg((s) => s.b[b] ?? 0);
        if (!close(got.behaviour[b], want)) bad.behaviour.push(`${group}/${subject}/${b}: ${got.behaviour[b]} vs ${want.toFixed(2)}`);
        if (b !== 'UNCLASSIFIED' && b !== 'LEFT') classified += want;
      }
      const answered = per.filter((s) => s.correct + s.incorrect > 0);
      const wantAcc = answered.length ? answered.reduce((n, s) => n + (100 * s.correct) / (s.correct + s.incorrect), 0) / answered.length : 0;
      if (!close(got.accuracy, wantAcc)) bad.accuracy.push(`${group}/${subject}: ${got.accuracy} vs ${wantAcc.toFixed(2)}`);

      const levels = new Set(per.flatMap((s) => Object.keys(s.levels)));
      for (const level of levels) {
        const gotLevel = stored.difficulty?.[group]?.[subject]?.[level];
        if (!gotLevel) {
          bad.difficulty.push(`${group}/${subject}/${level}: missing`);
          continue;
        }
        const withLevel = per.filter((s) => s.levels[level]);
        for (const f of ['correct', 'incorrect', 'skipped', 'notSeen', 'total']) {
          const want = withLevel.reduce((n, s) => n + s.levels[level][f], 0) / withLevel.length;
          if (!close(gotLevel[f], want)) bad.difficulty.push(`${group}/${subject}/${level}/${f}: ${gotLevel[f]} vs ${want.toFixed(2)}`);
        }
      }
    }
  }

  check('every group and subject is stored', bad.missing.length === 0, bad.missing.slice(0, 3).join(' | '));
  check('marks, the four-way split and timings match', bad.fields.length === 0, bad.fields.slice(0, 3).join(' | '));
  check('behaviour counts match the app’s own classifier', bad.behaviour.length === 0, bad.behaviour.slice(0, 3).join(' | '));
  check('the classifier actually classified questions here', classified > 0, `${classified.toFixed(1)} solid/slow/wasted/rushed/stuck on average`);
  check('accuracy matches', bad.accuracy.length === 0, bad.accuracy.slice(0, 3).join(' | '));
  check('the difficulty split matches', bad.difficulty.length === 0, bad.difficulty.slice(0, 3).join(' | '));

  await db.$disconnect();
  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
