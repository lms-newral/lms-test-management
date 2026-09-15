/**
 * Is the analytics job right?
 *
 * Everything it stamps is recomputed here in plain JavaScript, straight from the
 * attempt rows — no SQL, no shared code with the job beyond the rank rules the
 * spec already fixes. Then the two are compared.
 *
 *   REDIS_PORT=6380 node loadtest/verify-analytics.js [testId]
 */
const { prisma } = require('./lib');
const { rankOf, percentileOf, topperCutoff, MIN_COHORT } = require('../dist/src/modules/exam/analytics-rank.logic');

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) failures++;
};
const close = (a, b, tolerance = 0.02) => a !== null && b !== null && Math.abs(Number(a) - Number(b)) <= tolerance;

async function main() {
  const db = prisma();
  let testId = process.argv[2];
  if (!testId) {
    const latest = await db.examAttempt.findFirst({
      where: { finalizedAt: { not: null } },
      orderBy: { finalizedAt: 'desc' },
      select: { testId: true },
    });
    testId = latest?.testId;
  }
  if (!testId) throw new Error('No finalised attempts to check. Run loadtest/accuracy.js first.');

  const attempts = await db.examAttempt.findMany({
    where: { testId, finalizedAt: { not: null }, score: { not: null } },
    select: { id: true, score: true, rank: true, rankOutOf: true, percentile: true, analyticsAt: true, summary: true },
  });
  const analytics = await db.testAnalytics.findUnique({ where: { testId } });
  console.log(`Test ${testId}: ${attempts.length} scored attempt(s)\n`);

  if (!analytics) {
    check('the analytics job has run for this test', false, 'no TestAnalytics row — is the worker running? it debounces 60s');
    process.exit(1);
  }

  // ── ground truth, computed here ──────────────────────────────────────────
  const scoresDesc = attempts.map((a) => Number(a.score)).sort((x, y) => y - x);
  const n = scoresDesc.length;

  check('the cohort size matches', analytics.attemptCount === n, `stored ${analytics.attemptCount}, actual ${n}`);
  check('the top score matches', close(analytics.topScore, scoresDesc[0]), `stored ${analytics.topScore}, actual ${scoresDesc[0]}`);
  const mean = scoresDesc.reduce((s, x) => s + x, 0) / n;
  check('the mean matches', close(analytics.meanScore, mean), `stored ${analytics.meanScore}, actual ${mean.toFixed(2)}`);
  const sorted = [...scoresDesc].sort((x, y) => x - y);
  const median = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  check('the median matches', close(analytics.medianScore, median), `stored ${analytics.medianScore}, actual ${median}`);
  check('the top 10% cut-off matches', close(analytics.top10Cutoff, topperCutoff(scoresDesc, 0.1)), `stored ${analytics.top10Cutoff}, actual ${topperCutoff(scoresDesc, 0.1)}`);
  check('the top 25% cut-off matches', close(analytics.top25Cutoff, topperCutoff(scoresDesc, 0.25)), `stored ${analytics.top25Cutoff}, actual ${topperCutoff(scoresDesc, 0.25)}`);

  // ── every attempt's rank and percentile ──────────────────────────────────
  const badRank = [];
  const badPct = [];
  const badOutOf = [];
  const ranked = n >= MIN_COHORT;
  for (const a of attempts) {
    const score = Number(a.score);
    if (!ranked) {
      if (a.rank !== null) badRank.push(`${a.id}: ranked in a cohort of ${n}`);
      continue;
    }
    const expectedRank = rankOf(scoresDesc, score);
    const expectedPct = percentileOf(scoresDesc, score);
    if (a.rank !== expectedRank) badRank.push(`${a.id}: ${a.rank} vs ${expectedRank} (score ${score})`);
    if (!close(a.percentile, expectedPct)) badPct.push(`${a.id}: ${a.percentile} vs ${expectedPct}`);
    if (a.rankOutOf !== n) badOutOf.push(`${a.id}: ${a.rankOutOf} vs ${n}`);
  }
  check(ranked ? 'every rank matches, ties included' : 'a small cohort is left unranked', badRank.length === 0, badRank.slice(0, 3).join(' | '));
  if (ranked) {
    check('every percentile matches', badPct.length === 0, badPct.slice(0, 3).join(' | '));
    check('every attempt carries the cohort size', badOutOf.length === 0, badOutOf.slice(0, 3).join(' | '));
    const top = attempts.find((a) => Number(a.score) === scoresDesc[0]);
    check('the topper is rank 1 at the 100th percentile', top.rank === 1 && close(top.percentile, 100), `rank ${top.rank}, pct ${top.percentile}`);
    check('ranks are stamped with a time', attempts.every((a) => a.analyticsAt !== null));
  }

  // ── per-question class statistics ────────────────────────────────────────
  const rows = await db.examAttemptQuestion.findMany({
    where: { attempt: { testId, finalizedAt: { not: null }, score: { not: null } } },
    select: { questionId: true, result: true, timeMs: true },
  });
  const byQuestion = new Map();
  for (const r of rows) {
    const q = byQuestion.get(r.questionId) ?? { attempts: 0, correct: 0, incorrect: 0, unanswered: 0, time: 0 };
    q.attempts++;
    if (r.result === 'CORRECT') q.correct++;
    if (r.result === 'INCORRECT') q.incorrect++;
    if (r.result === 'UNANSWERED') q.unanswered++;
    q.time += r.timeMs;
    byQuestion.set(r.questionId, q);
  }
  const stats = await db.testQuestionStat.findMany({ where: { testId } });
  const statOf = new Map(stats.map((s) => [s.questionId, s]));

  const badStat = [];
  for (const [questionId, expected] of byQuestion) {
    const got = statOf.get(questionId);
    if (!got) {
      badStat.push(`${questionId}: no stat row`);
      continue;
    }
    if (got.attempts !== expected.attempts) badStat.push(`${questionId}: attempts ${got.attempts} vs ${expected.attempts}`);
    if (got.correct !== expected.correct) badStat.push(`${questionId}: correct ${got.correct} vs ${expected.correct}`);
    if (got.unanswered !== expected.unanswered) badStat.push(`${questionId}: unanswered ${got.unanswered} vs ${expected.unanswered}`);
    const avg = Math.round(expected.time / expected.attempts);
    if (Math.abs((got.avgTimeMs ?? 0) - avg) > 1) badStat.push(`${questionId}: avgTime ${got.avgTimeMs} vs ${avg}`);
  }
  check('a stat row per question, with matching counts and timings', badStat.length === 0, badStat.slice(0, 3).join(' | '));
  check('no stat rows for questions nobody answered', stats.length === byQuestion.size, `${stats.length} stats, ${byQuestion.size} questions`);

  // ── subject aggregates ───────────────────────────────────────────────────
  const subjectStats = analytics.subjectStats ?? {};
  const subjects = Object.keys(subjectStats.all ?? {});
  check('every subject has a cohort average', subjects.length > 0, subjects.join(', '));
  check('the top 10% are aggregated too', Object.keys(subjectStats.top10 ?? {}).length === subjects.length);
  // Only the total is guaranteed: a student can top the paper while sitting below
  // average in one subject, so per-subject dominance is not an invariant.
  const total = (stats) => subjects.reduce((sum, s) => sum + (stats[s]?.score ?? 0), 0);
  check(
    'the top 10% total above the cohort, and the top 25% between them',
    total(subjectStats.top10) >= total(subjectStats.top25) && total(subjectStats.top25) >= total(subjectStats.all),
    `top10 ${total(subjectStats.top10).toFixed(2)}, top25 ${total(subjectStats.top25).toFixed(2)}, all ${total(subjectStats.all).toFixed(2)}`,
  );

  await db.$disconnect();
  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
