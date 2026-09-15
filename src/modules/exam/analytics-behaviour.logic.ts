/**
 * Attempt Behaviour: how a question was handled, judged against the class.
 *
 * The yardstick is how long the students who got that question RIGHT took on it
 * — the honest measure of "how long this should take". Faster and correct is
 * Solid; slower and wrong is Wasted. Where the class has barely touched a
 * question there is no yardstick, and the question is left unclassified rather
 * than guessed at.
 *
 * Pure. Spec: test/exam/analytics-behaviour.test.js.
 */

export type Behaviour =
  | 'SOLID'
  | 'SLOW'
  | 'WASTED'
  | 'RUSHED'
  | 'STUCK'
  | 'LEFT'
  | 'NOT_SEEN'
  | 'UNCLASSIFIED';

export const BEHAVIOURS: Behaviour[] = [
  'SOLID',
  'SLOW',
  'WASTED',
  'RUSHED',
  'STUCK',
  'LEFT',
  'NOT_SEEN',
  'UNCLASSIFIED',
];

/** Fewer classmates than this on a question and there is nothing to compare against. */
export const MIN_CLASS_ATTEMPTS = 10;

export const BEHAVIOUR_LABELS: Record<Behaviour, string> = {
  SOLID: 'Solid — right, and quicker than the class',
  SLOW: 'Slow — right, but it cost you time',
  WASTED: 'Wasted — a long time spent, and still wrong',
  RUSHED: 'Rushed — wrong, and answered too quickly',
  STUCK: 'Stuck — a long time spent, and nothing answered',
  LEFT: 'Left — looked at and moved on',
  NOT_SEEN: 'Not seen — never opened',
  UNCLASSIFIED: 'Not enough class data to judge',
};

export interface BehaviourQuestion {
  result: string;
  marks: number;
  timeMs: number;
  visits: number;
}

export interface ClassTiming {
  attempts: number;
  avgTimeMs: number | null;
  avgTimeCorrectMs: number | null;
}

export function classify(
  question: BehaviourQuestion,
  stat: ClassTiming | null,
): Behaviour {
  if (!question.visits) return 'NOT_SEEN';
  if (question.result === 'DROPPED' || question.result === 'NOT_EVALUATED')
    return 'UNCLASSIFIED';
  if (!stat || stat.attempts < MIN_CLASS_ATTEMPTS) return 'UNCLASSIFIED';

  // What the class needed to get it right; if nobody did, what the class spent on it at all.
  const yardstick = stat.avgTimeCorrectMs ?? stat.avgTimeMs;
  if (yardstick === null || yardstick === undefined) return 'UNCLASSIFIED';

  const quicker = question.timeMs < yardstick;
  if (question.result === 'CORRECT' || question.result === 'PARTIAL')
    return quicker ? 'SOLID' : 'SLOW';
  if (question.result === 'INCORRECT') return quicker ? 'RUSHED' : 'WASTED';
  return quicker ? 'LEFT' : 'STUCK';
}

export interface BehaviourTotals {
  count: number;
  marks: number;
  timeMs: number;
}

/** Every behaviour is present, including the ones at zero, so the chart never shifts. */
export function behaviourSummary(
  rows: (BehaviourQuestion & { questionId: string })[],
  statOf: Map<string, ClassTiming | null>,
): Record<Behaviour, BehaviourTotals> {
  const summary = Object.fromEntries(
    BEHAVIOURS.map((b) => [b, { count: 0, marks: 0, timeMs: 0 }]),
  ) as Record<Behaviour, BehaviourTotals>;
  for (const row of rows) {
    const bucket = summary[classify(row, statOf.get(row.questionId) ?? null)];
    bucket.count++;
    bucket.marks += row.marks;
    bucket.timeMs += row.timeMs;
  }
  return summary;
}
