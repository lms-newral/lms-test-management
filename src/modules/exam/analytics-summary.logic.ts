/**
 * The Result Summary: the scored totals plus where the student stands.
 *
 * When too few students have taken the test for a real rank, the format's
 * admin-set percentile bands still give a projection. The summary always says
 * which of the two it is showing, so a projection is never read as a rank.
 *
 * Pure. Spec: test/exam/analytics-summary.test.js.
 */
import type { Totals } from './attempt-scoring.logic';

export interface PercentileBand {
  minScore: number | { toString(): string };
  maxScore: number | { toString(): string };
  percentile: number | { toString(): string };
}

export interface SummaryInput {
  totals: Totals;
  timeUsedMs: number;
  rank: number | null;
  rankOutOf: number;
  percentile: number | null;
}

export interface ResultSummary extends Totals {
  score: number;
  timeUsedMs: number;
  rank: number | null;
  rankOutOf: number;
  percentile: number | null;
  percentileSource: 'COHORT' | 'PROJECTED' | null;
}

/** The band a score falls in, edges included. Decimal columns arrive as objects. */
export function projectedPercentile(
  score: number,
  bands: PercentileBand[],
): number | null {
  const band = (bands ?? []).find(
    (b) => score >= Number(b.minScore) && score <= Number(b.maxScore),
  );
  return band ? Number(band.percentile) : null;
}

export function resultSummary(
  input: SummaryInput,
  bands: PercentileBand[],
): ResultSummary {
  const { totals } = input;
  const ranked = input.rank !== null && input.percentile !== null;
  const projected = ranked ? null : projectedPercentile(totals.total, bands);
  return {
    ...totals,
    score: totals.total,
    timeUsedMs: input.timeUsedMs,
    rank: input.rank,
    rankOutOf: input.rankOutOf,
    percentile: ranked ? input.percentile : projected,
    percentileSource: ranked
      ? 'COHORT'
      : projected !== null
        ? 'PROJECTED'
        : null,
  };
}
