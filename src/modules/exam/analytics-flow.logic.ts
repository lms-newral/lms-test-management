/**
 * Solving Flow: the order the paper was actually worked in.
 *
 * Not the printed order — the real path, 1 → 2 → 5 → back to 1, with how long
 * each stop took and how that question finally ended up. Rebuilt from the visit
 * spans, so a question opened three times appears three times, in sequence.
 *
 * Pure. Spec: test/exam/analytics-flow.test.js.
 */

export interface FlowRow {
  questionId: string;
  orderIndex: number;
  subjectName: string | null;
  result: string;
  marks: number;
  visitTimeline?: { enterMs: number; leaveMs: number | null }[] | null;
}

export interface FlowStep {
  step: number;
  questionId: string;
  /** The question's number on the paper, as the student sees it. */
  number: number;
  subjectName: string | null;
  result: string;
  marks: number;
  enterMs: number;
  durationMs: number;
}

export interface SolvingFlow {
  steps: FlowStep[];
  questionsVisited: number;
  revisited: number;
  longest: FlowStep | null;
}

export function solvingFlow(rows: FlowRow[], endMs: number): SolvingFlow {
  const stops: Omit<FlowStep, 'step'>[] = [];
  const visitsPerQuestion = new Map<string, number>();

  for (const row of rows) {
    for (const visit of row.visitTimeline ?? []) {
      const leave = visit.leaveMs ?? endMs; // still open when the paper ended
      stops.push({
        questionId: row.questionId,
        number: row.orderIndex + 1,
        subjectName: row.subjectName,
        result: row.result,
        marks: row.marks,
        enterMs: visit.enterMs,
        durationMs: Math.max(0, leave - visit.enterMs),
      });
      visitsPerQuestion.set(
        row.questionId,
        (visitsPerQuestion.get(row.questionId) ?? 0) + 1,
      );
    }
  }

  const steps = stops
    .sort((a, b) => a.enterMs - b.enterMs)
    .map((stop, i) => ({ step: i + 1, ...stop }));

  return {
    steps,
    questionsVisited: visitsPerQuestion.size,
    revisited: [...visitsPerQuestion.values()].filter((n) => n > 1).length,
    longest: steps.reduce<FlowStep | null>(
      (best, s) => (!best || s.durationMs > best.durationMs ? s : best),
      null,
    ),
  };
}
