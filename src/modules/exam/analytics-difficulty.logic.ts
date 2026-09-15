/**
 * Difficulty Breakup: how the student did on the easy, medium and hard
 * questions, next to how the whole cohort did on the same set.
 *
 * Pure. Spec: test/exam/analytics-time.test.js.
 */

export interface DifficultyRow {
  difficulty?: string | null;
  result: string;
  timeMs: number;
}

export interface ClassDifficulty {
  attempts: number;
  accuracy: number;
  avgTimeMs: number;
}

export interface DifficultyBand {
  difficulty: string;
  total: number;
  correct: number;
  incorrect: number;
  unanswered: number;
  accuracy: number | null;
  timeMs: number;
  avgTimeMs: number;
  classAccuracy: number | null;
  classAvgTimeMs: number | null;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const ORDER = ['EASY', 'MEDIUM', 'HARD'];

export function difficultyBreakup(
  rows: DifficultyRow[],
  classStats: Record<string, ClassDifficulty> | null | undefined,
): DifficultyBand[] {
  const bands = new Map<string, DifficultyBand>();
  for (const row of rows) {
    if (!row.difficulty) continue;
    const band = bands.get(row.difficulty) ?? {
      difficulty: row.difficulty,
      total: 0,
      correct: 0,
      incorrect: 0,
      unanswered: 0,
      accuracy: null,
      timeMs: 0,
      avgTimeMs: 0,
      classAccuracy: null,
      classAvgTimeMs: null,
    };
    band.total++;
    band.timeMs += row.timeMs;
    if (row.result === 'CORRECT' || row.result === 'PARTIAL') band.correct++;
    else if (row.result === 'INCORRECT') band.incorrect++;
    else band.unanswered++;
    bands.set(row.difficulty, band);
  }

  return [...bands.values()]
    .map((band) => {
      const attempted = band.correct + band.incorrect;
      const fromClass = classStats?.[band.difficulty];
      return {
        ...band,
        accuracy:
          attempted > 0 ? round2((band.correct / attempted) * 100) : null,
        avgTimeMs: band.total > 0 ? Math.round(band.timeMs / band.total) : 0,
        classAccuracy: fromClass ? round2(fromClass.accuracy) : null,
        classAvgTimeMs: fromClass ? Math.round(fromClass.avgTimeMs) : null,
      };
    })
    .sort((a, b) => {
      const ai = ORDER.indexOf(a.difficulty);
      const bi = ORDER.indexOf(b.difficulty);
      if (ai === -1 && bi === -1)
        return a.difficulty.localeCompare(b.difficulty);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
}
