/**
 * Compare with Toppers, subject by subject.
 *
 * Every comparison is a report of what the cohort actually did. Where the cohort
 * has nothing to say — too few students, or a subject none of them reached — the
 * comparison is null, never a zero that would read as "the toppers scored
 * nothing there".
 *
 * Pure. Spec: test/exam/analytics-compare.test.js.
 */

export interface SubjectStat {
  score: number;
  timeMs: number;
  accuracy: number;
}

export type SubjectStats = Record<string, SubjectStat>;

export interface SubjectComparison {
  subject: string;
  mine: SubjectStat;
  top10: SubjectStat | null;
  top25: SubjectStat | null;
  everyone: SubjectStat | null;
  /** Against the top 10%: negative means behind them, positive means ahead. */
  scoreGap: number | null;
  /** Positive means the student spent longer than the top 10% did. */
  timeGap: number | null;
  accuracyGap: number | null;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function compareSubjects(
  mine: SubjectStats,
  top10: SubjectStats,
  top25: SubjectStats,
  everyone: SubjectStats,
): SubjectComparison[] {
  return Object.entries(mine).map(([subject, own]) => {
    const best = top10?.[subject] ?? null;
    return {
      subject,
      mine: own,
      top10: best,
      top25: top25?.[subject] ?? null,
      everyone: everyone?.[subject] ?? null,
      scoreGap: best ? round2(own.score - best.score) : null,
      timeGap: best ? own.timeMs - best.timeMs : null,
      accuracyGap: best ? round2(own.accuracy - best.accuracy) : null,
    };
  });
}
