// SPEC (written before the code): rank, percentile and the topper cohorts.
//
// Rank compares a student against everyone who has ever taken this test, in any series, so the
// cohort keeps growing and every rank is only true as of the moment it was computed.
//
// The job does the ranking in SQL at 100k scale; these are the rules that SQL must implement, and
// the same functions score small cohorts and verify the job's output.
//
// Module under test: src/modules/exam/analytics-rank.logic.ts
//   MIN_COHORT                                 -> 10
//   enoughForRank(total)                       -> boolean
//   rankOf(scoresDesc, score)                  -> 1-based competition rank (1, 2, 2, 4)
//   percentileOf(scoresDesc, score)            -> NTA style: share scoring at or below, 0-100
//   topperCutoff(scoresDesc, fraction)         -> lowest score still inside the top fraction
//   cohortBand(rank, total)                    -> 'TOP_10' | 'TOP_25' | null
const {
  MIN_COHORT,
  enoughForRank,
  rankOf,
  percentileOf,
  topperCutoff,
  cohortBand,
} = require('../../dist/src/modules/exam/analytics-rank.logic');

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) failures++;
};

const scores = [300, 280, 280, 250, 200, 120]; // always highest first

/* --- 1. Rank, with ties ---------------------------------------------------- */

check('the top score is rank 1', rankOf(scores, 300) === 1);
check('a tie shares the better rank', rankOf(scores, 280) === 2);
check('the rank after a tie skips, as in a competition', rankOf(scores, 250) === 4);
check('the last score ranks last', rankOf(scores, 120) === 6);
check('a score nobody has ranks where it would fall', rankOf(scores, 260) === 4);
check('an empty cohort ranks first', rankOf([], 100) === 1);

/* --- 2. Percentile --------------------------------------------------------- */
// NTA: the percentage of candidates who scored at or below you. The topper is always 100.

check('the topper is the 100th percentile', percentileOf(scores, 300) === 100);
check('the lowest score is not zero, it is above nobody but itself', percentileOf(scores, 120) === 16.67);
check('tied students get the same percentile', percentileOf(scores, 280) === percentileOf(scores, 280));
check('a mid score counts everyone at or below', percentileOf(scores, 250) === 50);
check('percentile is rounded to two places', String(percentileOf(scores, 200)).length <= 6, String(percentileOf(scores, 200)));
check('an empty cohort has no percentile', percentileOf([], 100) === 0);

/* --- 3. Topper cohorts ------------------------------------------------------ */

const hundred = Array.from({ length: 100 }, (_, i) => 300 - i); // 300 down to 201

check('the top 10% cutoff keeps ten students', topperCutoff(hundred, 0.1) === 291);
check('the top 25% cutoff keeps twenty-five', topperCutoff(hundred, 0.25) === 276);
check('rank 10 of 100 is in the top 10%', cohortBand(10, 100) === 'TOP_10');
check('rank 11 of 100 is in the top 25%', cohortBand(11, 100) === 'TOP_25');
check('rank 25 of 100 is still top 25%', cohortBand(25, 100) === 'TOP_25');
check('rank 26 of 100 is in neither', cohortBand(26, 100) === null);
check('a small cohort still has a top 10% of at least one', cohortBand(1, 10) === 'TOP_10' && cohortBand(2, 10) === 'TOP_25');
check('the cutoff of an empty cohort is null', topperCutoff([], 0.1) === null);

/* --- 4. Too few students to compare ----------------------------------------- */
// Ten students is the floor: below that a "rank" and a "percentile" mislead more than they inform.

check('the floor is ten', MIN_COHORT === 10);
check('nine students is not enough', enoughForRank(9) === false);
check('ten students is enough', enoughForRank(10) === true);
check('one student is never enough', enoughForRank(1) === false);

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
