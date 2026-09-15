// SPEC (written before the code): the Result Summary a student sees first.
//
// It is the scored totals plus where the student stands. When the cohort is too small for a real
// rank, the format's admin-set percentile bands (TestPercentileBand) still give a projection — and
// the summary always says which of the two it is showing, so nobody reads a projection as a rank.
//
// Module under test: src/modules/exam/analytics-summary.logic.ts
//   projectedPercentile(score, bands)  -> number | null
//   resultSummary({ totals, timeUsedMs, rank, rankOutOf, percentile }, bands) -> summary
const { projectedPercentile, resultSummary } = require('../../dist/src/modules/exam/analytics-summary.logic');

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) failures++;
};

// As an admin sets them on the format: a score range mapped to a percentile.
const bands = [
  { minScore: 0, maxScore: 99, percentile: 40 },
  { minScore: 100, maxScore: 199, percentile: 75 },
  { minScore: 200, maxScore: 300, percentile: 98 },
];

const totals = {
  total: 212,
  maxMarks: 300,
  gained: 232,
  deducted: 20,
  correct: 58,
  incorrect: 20,
  partial: 0,
  dropped: 0,
  attempted: 78,
  skipped: 8,
  notSeen: 4,
  notEvaluated: 0,
  accuracy: 74.36,
};

/* --- 1. Projected percentile from the format's bands ----------------------- */

check('a score inside a band takes its percentile', projectedPercentile(150, bands) === 75);
check('the lower edge of a band is inside it', projectedPercentile(100, bands) === 75);
check('the upper edge of a band is inside it', projectedPercentile(199, bands) === 75);
check('the top band covers the top score', projectedPercentile(300, bands) === 98);
check('a score past every band has no projection', projectedPercentile(400, bands) === null);
check('no bands configured means no projection', projectedPercentile(150, []) === null);

/* --- 2. The summary, with a real cohort ------------------------------------ */

const ranked = resultSummary({ totals, timeUsedMs: 9_540_000, rank: 412, rankOutOf: 3180, percentile: 87.04 }, bands);

check('the score comes through', ranked.score === 212 && ranked.maxMarks === 300);
check('the answer counts come through', ranked.correct === 58 && ranked.incorrect === 20 && ranked.skipped === 8 && ranked.notSeen === 4);
check('marks gained and deducted are kept apart', ranked.gained === 232 && ranked.deducted === 20);
check('accuracy comes through', ranked.accuracy === 74.36);
check('time used comes through', ranked.timeUsedMs === 9_540_000);
check('the rank and its cohort are shown together', ranked.rank === 412 && ranked.rankOutOf === 3180);
check('a real percentile beats the projection', ranked.percentile === 87.04);
check('and the summary says it is the real one', ranked.percentileSource === 'COHORT');

/* --- 3. The summary when too few students have taken it -------------------- */
// The caller passes no rank; the projection fills in, clearly labelled.

const unranked = resultSummary({ totals, timeUsedMs: 9_540_000, rank: null, rankOutOf: 7, percentile: null }, bands);

check('no rank is shown', unranked.rank === null);
check('the cohort size is still honest', unranked.rankOutOf === 7);
check('the projection stands in', unranked.percentile === 98);
check('and it is labelled a projection', unranked.percentileSource === 'PROJECTED');

const nothing = resultSummary({ totals, timeUsedMs: 1000, rank: null, rankOutOf: 3, percentile: null }, []);
check('with neither a cohort nor bands, no percentile is invented', nothing.percentile === null && nothing.percentileSource === null);

/* --- 4. Edges --------------------------------------------------------------- */

const blank = { ...totals, total: 0, gained: 0, deducted: 0, correct: 0, incorrect: 0, attempted: 0, accuracy: 0 };
const untouched = resultSummary({ totals: blank, timeUsedMs: 0, rank: null, rankOutOf: 0, percentile: null }, bands);
check('a paper nobody answered has zero accuracy, not a divide by zero', untouched.accuracy === 0);
check('a zero score still finds its band', untouched.percentile === 40 && untouched.percentileSource === 'PROJECTED');

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
