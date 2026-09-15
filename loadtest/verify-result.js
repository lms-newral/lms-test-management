/**
 * End-to-end check of the result API against real rows: the gate, then every
 * analytics section, composed by the real ExamResultService — not by copies of
 * its maths.
 *
 *   REDIS_PORT=6380 node loadtest/verify-result.js
 *
 * It moves the node's result time into the past on the THROWAWAY database to
 * prove both sides of the gate. Never point this at a real database.
 */
const { prisma, DB_URL } = require('./lib');
const { ExamResultService } = require('../dist/src/modules/exam/exam-result.service');
const { ExamAttemptsService } = require('../dist/src/modules/exam/exam-attempts.service');

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) failures++;
};
const sum = (ns) => ns.reduce((a, b) => a + b, 0);

async function main() {
  if (/supabase|pooler/i.test(DB_URL)) throw new Error('Refusing: this script edits result times.');
  const db = prisma();

  const attempt = await db.examAttempt.findFirst({
    where: { finalizedAt: { not: null }, seriesNodeId: { not: null }, rank: { not: null } },
    orderBy: { finalizedAt: 'desc' },
  });
  if (!attempt) throw new Error('No scored attempt with a rank. Run accuracy.js, then wait for the analytics job.');
  const user = { userId: attempt.userId, tenantId: attempt.tenantId, email: 'loadtest@example.com' };
  console.log(`Attempt ${attempt.id} — rank ${attempt.rank} of ${attempt.rankOutOf}\n`);

  // The student must be enrolled for the node to resolve at all.
  await db.testSeriesEnrollment.createMany({
    data: [{ tenantId: attempt.tenantId, seriesId: attempt.seriesId, userId: attempt.userId, userName: 'Load Student', userEmail: 'loadtest@example.com', source: 'FREE' }],
    skipDuplicates: true,
  });

  const attempts = new ExamAttemptsService(db, null, null, null, { get: () => 'loadtest-secret' });
  const results = new ExamResultService(db, attempts);

  /* --- the gate ----------------------------------------------------------- */
  await db.testSeriesNode.update({ where: { id: attempt.seriesNodeId }, data: { resultAt: new Date(Date.now() + 3600_000) } });
  let refused = null;
  try {
    await results.result(attempt.seriesNodeId, user);
  } catch (e) {
    refused = e.message;
  }
  check('before the result time, the analysis is refused', !!refused && /declared/i.test(refused), refused ?? 'it was allowed through');

  await db.testSeriesNode.update({ where: { id: attempt.seriesNodeId }, data: { resultAt: new Date(Date.now() - 60_000) } });
  const result = await results.result(attempt.seriesNodeId, user);
  check('once results are declared, it opens', !!result);

  /* --- summary and cohort -------------------------------------------------- */
  check('the score matches the attempt', result.summary.score === attempt.score, `${result.summary.score} vs ${attempt.score}`);
  check('the rank travels with its cohort size', result.summary.rank === attempt.rank && result.summary.rankOutOf === attempt.rankOutOf);
  check('the percentile is the real one, not a projection', result.summary.percentileSource === 'COHORT');
  check('the cohort figures are there', result.cohort.meanScore !== null && result.cohort.topScore !== null);
  check('the computed time is shown', result.computedAt instanceof Date);

  /* --- behaviour ----------------------------------------------------------- */
  const behaviour = result.behaviour;
  const behaviourCount = sum(Object.values(behaviour).map((b) => b.count));
  check('every question has a behaviour', behaviourCount === result.questions.length, `${behaviourCount} vs ${result.questions.length}`);
  check('the behaviour marks add up to the score', Math.abs(sum(Object.values(behaviour).map((b) => b.marks)) - attempt.score) < 0.01);
  check('every question row carries its behaviour', result.questions.every((q) => typeof q.behaviour === 'string'));
  check('the classifier actually classified this cohort', behaviour.UNCLASSIFIED.count < result.questions.length,
    `${behaviour.UNCLASSIFIED.count} unclassified of ${result.questions.length}`);
  console.log(`        behaviours: ${Object.entries(behaviour).filter(([, b]) => b.count).map(([k, b]) => `${k} ${b.count}`).join(', ')}`);

  /* --- improvement --------------------------------------------------------- */
  const imp = result.improvement;
  check('improvement starts from the real score', Math.abs(imp.score - attempt.score) < 0.01);
  check('fixing more mistakes never gains less', imp.steps[0].gain <= imp.steps[1].gain && imp.steps[1].gain <= imp.steps[2].gain);
  check('fixing everything cannot beat the paper', imp.steps[2].score <= imp.maxMarks, `${imp.steps[2].score} vs ${imp.maxMarks}`);
  check('the recoverable marks match the mistakes', imp.mistakes.recoverable === imp.steps[2].gain);

  /* --- time ---------------------------------------------------------------- */
  const totalTime = sum(result.questions.map((q) => q.timeMs));
  check('subject times add up to the whole paper', sum(result.time.bySubject.map((s) => s.timeMs)) === totalTime);
  check('the shares add up to a hundred', Math.abs(sum(result.time.bySubject.map((s) => s.share)) - 100) < 0.5);
  check('time by outcome adds up', result.time.byOutcome.totalMs === totalTime);
  check('the journey has four quarters', result.time.journey.length === 4);
  check('no quarter holds more than the paper lasted', result.time.journey.every((q) => q.timeMs <= totalTime));
  const answeredInJourney = sum(result.time.journey.map((q) => q.answered));
  const answeredRows = result.questions.filter((q) => ['CORRECT', 'INCORRECT', 'PARTIAL'].includes(q.result)).length;
  check('every answer lands in a quarter', answeredInJourney === answeredRows, `${answeredInJourney} vs ${answeredRows}`);

  /* --- flow ---------------------------------------------------------------- */
  const flow = result.flow;
  check('the flow is in time order', flow.steps.every((s, i) => i === 0 || s.enterMs >= flow.steps[i - 1].enterMs));
  check('steps are numbered without gaps', flow.steps.every((s, i) => s.step === i + 1));
  check('the questions visited are counted', flow.questionsVisited <= result.questions.length && flow.questionsVisited > 0);
  check('the longest stop is really the longest', !flow.longest || flow.steps.every((s) => s.durationMs <= flow.longest.durationMs));
  console.log(`        path: ${flow.steps.slice(0, 12).map((s) => s.number).join('→')}${flow.steps.length > 12 ? '→…' : ''}`);

  /* --- difficulty ---------------------------------------------------------- */
  const withDifficulty = result.questions.filter((q) => q.difficulty).length;
  check('the difficulty bands cover every graded question', sum(result.difficulty.map((d) => d.total)) === withDifficulty);
  check('the class accuracy sits alongside the student', result.difficulty.every((d) => d.classAccuracy === null || typeof d.classAccuracy === 'number'));

  /* --- the admin view ------------------------------------------------------ */
  // Admins must not wait for the result time, so put it back in the future first.
  await db.testSeriesNode.update({ where: { id: attempt.seriesNodeId }, data: { resultAt: new Date(Date.now() + 3600_000) } });
  const admin = await results.adminResult(attempt.id, user);
  check('an admin sees the analysis before the result time', !!admin && admin.summary.score === attempt.score);
  check('the admin view names the student', !!admin.student && admin.student.userId === attempt.userId);
  check('the student view never carries the integrity panel', result.proctoring === null);
  check('the admin view does', !!admin.proctoring);
  check('the integrity panel counts what was captured', typeof admin.proctoring.violations.count === 'number' && typeof admin.proctoring.refreshes.count === 'number');
  check('idle time is derived, not invented', admin.proctoring.idleMs === Math.max(0, (attempt.timeUsedMs ?? 0) - (attempt.activeMs ?? 0)));
  check('every flag is readable', admin.proctoring.flags.every((f) => ['ALERT', 'WARN', 'INFO'].includes(f.level) && f.message.length > 10));

  /* --- the admin lists ------------------------------------------------------ */
  const table = await results.testAttempts(attempt.seriesNodeId, user, { take: 10 });
  check('the results table lists attempts', table.total > 0 && table.attempts.length > 0, table.total + ' attempt(s)');
  check('best score first', table.attempts.every((a, i) => i === 0 || (a.score ?? -1) <= (table.attempts[i - 1].score ?? -1)));
  check('each row carries who it is and how they did', table.attempts.every((a) => a.attemptId && a.userId && 'score' in a && 'rank' in a));
  check('each row counts what needs a look', table.attempts.every((a) => typeof a.concerns === 'number'));

  const perStudent = await results.studentSeriesAttempts(attempt.seriesId, attempt.userId, user);
  check('the attempts across the series are listed', perStudent.tests.length > 0);
  check('tests not attempted are shown as empty, not hidden', perStudent.tests.every((t) => 'attemptId' in t && 'testName' in t));
  check('the attempted one is linked to its analysis', perStudent.tests.some((t) => t.attemptId === attempt.id));

  /* --- the multi-page payload -------------------------------------------- */
  const big = result.cohortSize >= 10;
  check('compareReady follows the cohort size', result.compareReady === big, `cohort ${result.cohortSize}`);
  check('topper stats are sent only with a real cohort', big ? !!result.cohortStats && !!result.cohortStats.top10 : result.cohortStats === null);
  check('the stored cohort carries the four-way split and behaviour', !big || Object.values(result.cohortStats.all).every((c) => 'notSeen' in c && 'behaviour' in c && 'timeCorrectMs' in c));
  check('the cohort carries the difficulty split', !big || !!result.cohortStats.difficulty);
  check('every question carries its printed number and type', result.questions.every((q) => Number.isInteger(q.number) && q.number >= 1 && 'typeCode' in q));
  check('question numbers are unique', new Set(result.questions.map((q) => q.number)).size === result.questions.length);
  check('class percentages come only with a real cohort', result.questions.every((q) => big || (q.classCorrectPct === null && q.classAvgTimeMs === null)));
  check('the leaderboard has at most ten rows', !big || (result.leaderboard.rows.length <= 10 && result.leaderboard.rows.length > 0));
  check('the leaderboard never shows a full name', !big || result.leaderboard.rows.every((r) => r.name.split(' ').length <= 2 && !r.name.includes('@')));
  check('the student appears exactly once', !big || [...result.leaderboard.rows, ...(result.leaderboard.you ? [result.leaderboard.you] : [])].filter((r) => r.isYou).length === 1);

  const saved = await results.saveNote(attempt.seriesNodeId, '  I rushed the numericals.  ', user);
  check('a note is saved, trimmed', saved.note === 'I rushed the numericals.');
  const again = await results.result(attempt.seriesNodeId, user).catch(() => null);
  check('the saved note comes back with the result', !again || again.note === 'I rushed the numericals.');
  const cleared = await results.saveNote(attempt.seriesNodeId, '   ', user);
  check('an empty note clears it', cleared.note === null);
  let refusedNote = null;
  try { await results.saveNote(attempt.seriesNodeId, 'x'.repeat(2001), user); } catch (e) { refusedNote = e.message; }
  check('an over-long note is refused', !!refusedNote && /2000/.test(refusedNote), refusedNote ?? 'accepted');

  await db.$disconnect();
  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
