/**
 * What a student may see after a test, in two gates:
 *   - solutions, once their own attempt is submitted and scored;
 *   - analytics (rank, percentile, comparison with toppers), only once results
 *     are declared, since they mean nothing until the cohort has finished.
 *
 * Pure. Spec: test/exam/attempt-review.test.js.
 */
import type { QuestionResult, ScoredAnswer } from './attempt-scoring.logic';

export type ReviewProblem = 'NOT_ATTEMPTED' | 'NOT_SUBMITTED' | 'RESULTS_PENDING' | 'SCORING';
export type ReviewStatus = 'CORRECT' | 'INCORRECT' | 'PARTIAL' | 'NOT_ANSWERED' | 'DROPPED';

export const REVIEW_MESSAGES: Record<ReviewProblem, string> = {
  NOT_ATTEMPTED: 'You have not attempted this test.',
  NOT_SUBMITTED: 'Submit the test to see its solutions.',
  RESULTS_PENDING: 'Solutions open when results are declared.',
  SCORING: 'Your paper is being checked. Please check again in a minute.',
};

export const ANALYTICS_MESSAGES: Record<ReviewProblem, string> = {
  NOT_ATTEMPTED: 'You have not attempted this test.',
  NOT_SUBMITTED: 'Submit the test to see your analysis.',
  RESULTS_PENDING: 'Your analysis opens when results are declared.',
  SCORING: 'Your result is being prepared. Please check again in a minute.',
};

/** Solutions: the student's own attempt has to be finished and scored, nothing more. */
export function reviewProblem(attempt: { status: string; finalizedAt: Date | null } | null): ReviewProblem | null {
  if (!attempt) return 'NOT_ATTEMPTED';
  if (attempt.status !== 'SUBMITTED') return 'NOT_SUBMITTED';
  if (!attempt.finalizedAt) return 'SCORING';
  return null;
}

/** Analytics: everything above, and the result time has to have arrived. */
export function analyticsProblem(
  attempt: { status: string; finalizedAt: Date | null; resultAt: Date | null } | null,
  now: Date,
): ReviewProblem | null {
  if (!attempt) return 'NOT_ATTEMPTED';
  if (attempt.status !== 'SUBMITTED') return 'NOT_SUBMITTED';
  if (!attempt.resultAt || now.getTime() < attempt.resultAt.getTime()) return 'RESULTS_PENDING';
  if (!attempt.finalizedAt) return 'SCORING';
  return null;
}

export function reviewPaletteStatus(result: QuestionResult): ReviewStatus {
  return result === 'UNANSWERED' || result === 'NOT_EVALUATED' ? 'NOT_ANSWERED' : result;
}

const numbers = (indexes: number[]) => (indexes.length ? indexes.map((i) => String(i + 1)).join(', ') : '—');

/** The student's answer as NTA shows it: option numbers, or the typed value. */
export function answerLabel(kernel: string, answer: ScoredAnswer, optionCount: number): string {
  if (!answer) return '—';
  if (kernel === 'NUMERIC' || typeof answer.value === 'number') return typeof answer.value === 'number' ? String(answer.value) : '—';
  const picked = [...new Set(answer.choice ?? [])].filter((i) => Number.isInteger(i) && i >= 0 && i < optionCount);
  return numbers(picked.sort((a, b) => a - b));
}

export function correctLabel(
  kernel: string,
  options: { isCorrect?: boolean }[] | null,
  answerConfig: { value?: unknown; tolerance?: unknown } | null,
): string {
  if (kernel === 'NUMERIC') {
    const value = answerConfig?.value;
    if (typeof value !== 'number') return '—';
    const tolerance = Number(answerConfig?.tolerance ?? 0);
    return tolerance > 0 ? `${value} ± ${tolerance}` : String(value);
  }
  return numbers((options ?? []).flatMap((o, i) => (o.isCorrect ? [i] : [])));
}
