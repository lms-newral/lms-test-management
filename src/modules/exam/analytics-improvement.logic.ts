/**
 * Improvement Scope: what the paper was worth if the mistakes had gone the other
 * way.
 *
 * A wrong answer costs twice — the marks not gained and the negative marks taken
 * — so fixing one is worth `maxMarks - marks`, a five mark swing on a +4/-1
 * question. Mistakes are ranked by that swing, and "fix a quarter of them" means
 * the quarter that was worth most.
 *
 * Blank questions are kept apart from mistakes: not answering is a missed
 * chance, not an error, and merging the two inflates the number a student sees.
 *
 * Pure. Spec: test/exam/analytics-improvement.test.js.
 */

export interface ImprovementRow {
  questionId: string;
  subjectName: string | null;
  result: string;
  marks: number;
  maxMarks: number;
}

export interface ImprovementStep {
  fraction: number;
  fixed: number;
  gain: number;
  score: number;
}

export interface SubjectScope {
  subject: string;
  mistakes: number;
  recoverable: number;
  skipped: number;
  skippedMarks: number;
}

export interface ImprovementScope {
  score: number;
  maxMarks: number;
  mistakes: { count: number; recoverable: number };
  skipped: { count: number; recoverable: number };
  steps: ImprovementStep[];
  bySubject: SubjectScope[];
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const sum = (ns: number[]) => ns.reduce((a, b) => a + b, 0);

export function improvementScope(
  rows: ImprovementRow[],
  fractions: number[] = [0.25, 0.5, 1],
): ImprovementScope {
  const score = sum(rows.map((r) => r.marks));
  const maxMarks = sum(rows.map((r) => r.maxMarks));

  const mistakes = rows
    .filter((r) => r.result === 'INCORRECT')
    .map((r) => ({ ...r, recoverable: r.maxMarks - r.marks }))
    .sort((a, b) => b.recoverable - a.recoverable);
  const skipped = rows.filter((r) => r.result === 'UNANSWERED');

  const steps = fractions.map((fraction) => {
    const fixed = Math.min(
      mistakes.length,
      Math.ceil(fraction * mistakes.length),
    );
    const gain = sum(mistakes.slice(0, fixed).map((m) => m.recoverable));
    return { fraction, fixed, gain: round2(gain), score: round2(score + gain) };
  });

  const bySubject = new Map<string, SubjectScope>();
  const of = (name: string | null) => {
    const subject = name ?? 'Other';
    if (!bySubject.has(subject))
      bySubject.set(subject, {
        subject,
        mistakes: 0,
        recoverable: 0,
        skipped: 0,
        skippedMarks: 0,
      });
    return bySubject.get(subject)!;
  };
  for (const m of mistakes) {
    const row = of(m.subjectName);
    row.mistakes++;
    row.recoverable = round2(row.recoverable + m.recoverable);
  }
  for (const s of skipped) {
    const row = of(s.subjectName);
    row.skipped++;
    row.skippedMarks = round2(row.skippedMarks + s.maxMarks);
  }

  return {
    score: round2(score),
    maxMarks: round2(maxMarks),
    mistakes: {
      count: mistakes.length,
      recoverable: round2(sum(mistakes.map((m) => m.recoverable))),
    },
    skipped: {
      count: skipped.length,
      recoverable: round2(sum(skipped.map((s) => s.maxMarks))),
    },
    steps,
    // Where the marks are hiding, most first.
    bySubject: [...bySubject.values()].sort(
      (a, b) =>
        b.recoverable - a.recoverable || b.skippedMarks - a.skippedMarks,
    ),
  };
}
