/**
 * Rank, percentile and the topper cohorts.
 *
 * A student is compared against everyone who has ever taken this test, in any
 * series, so the cohort grows over time and a rank is only true as of the moment
 * it was computed — the result always carries its cohort size and timestamp.
 *
 * The compute job does the ranking in SQL at 100k scale; these functions are the
 * rules it implements, and they score small cohorts and verify its output.
 *
 * Pure. Spec: test/exam/analytics-rank.test.js.
 */

/** Below this, a rank and a percentile mislead more than they inform. */
export const MIN_COHORT = 10;

export type CohortBand = 'TOP_10' | 'TOP_25';

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export const enoughForRank = (total: number) => total >= MIN_COHORT;

/** Competition ranking: two students on 280 are both 2nd, and the next is 4th. */
export function rankOf(scoresDesc: number[], score: number): number {
  let better = 0;
  for (const s of scoresDesc) {
    if (s > score) better++;
    else break;
  }
  return better + 1;
}

/** NTA's definition: the share of candidates who scored at or below you. */
export function percentileOf(scoresDesc: number[], score: number): number {
  if (scoresDesc.length === 0) return 0;
  let atOrBelow = 0;
  for (const s of scoresDesc) if (s <= score) atOrBelow++;
  return round2((atOrBelow / scoresDesc.length) * 100);
}

/** The lowest score still inside the top fraction — the cohort's cut-off. */
export function topperCutoff(
  scoresDesc: number[],
  fraction: number,
): number | null {
  if (scoresDesc.length === 0) return null;
  const take = Math.min(
    Math.max(1, Math.ceil(scoresDesc.length * fraction)),
    scoresDesc.length,
  );
  return scoresDesc[take - 1];
}

export function cohortBand(rank: number, total: number): CohortBand | null {
  if (total <= 0 || rank <= 0) return null;
  if (rank <= Math.max(1, Math.ceil(total * 0.1))) return 'TOP_10';
  if (rank <= Math.max(1, Math.ceil(total * 0.25))) return 'TOP_25';
  return null;
}
