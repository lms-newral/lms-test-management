/**
 * Scores an attempt against the frozen paper (QuestionUsage snapshots), with
 * JEE rules: single correct, multiple correct with partial marking, numerical
 * with tolerance, "attempt any N" sections, and NTA dropped / bonus questions.
 * Specs: test/exam/attempt-scoring.test.js and test/exam/attempt-scoring-insights.test.js.
 */
import { parseNumericAnswer } from './attempt-replay.logic';

export interface AnswerKey {
  kernel: string;
  options: { isCorrect?: boolean }[] | null;
  answerConfig: { value?: number; tolerance?: number; integerOnly?: boolean } | null;
  /** NTA dropped question: full marks to every candidate. */
  dropped?: boolean;
}

export interface Marking {
  marks: number;
  negativeMarks: number;
  partialMarking: boolean;
}

export type ScoredAnswer = { choice?: number[]; value?: number } | null;
export type QuestionResult = 'CORRECT' | 'INCORRECT' | 'PARTIAL' | 'UNANSWERED' | 'NOT_EVALUATED' | 'DROPPED';

export interface SheetRow {
  questionId: string;
  subjectName: string;
  sectionId?: string;
  orderIndex: number;
  key: AnswerKey;
  marking: Marking & { attemptLimit: number | null; rowId: string };
}

export interface AttemptQuestionState {
  status: string;
  answer: ScoredAnswer;
}

export interface Totals {
  total: number;
  maxMarks: number;
  gained: number;
  deducted: number;
  correct: number;
  incorrect: number;
  partial: number;
  dropped: number;
  attempted: number;
  skipped: number;
  notSeen: number;
  notEvaluated: number;
  accuracy: number;
}

export interface AttemptScore extends Totals {
  subjects: Record<string, Totals>;
  sections: Record<string, Totals>;
  questions: Record<string, { result: QuestionResult; marks: number; evaluated: boolean; maxMarks: number; negativeMarks: number }>;
}

const EPSILON = 1e-9;
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const penalty = (m: Marking) => (m.negativeMarks > 0 ? -m.negativeMarks : 0);

export function scoreQuestion(
  key: AnswerKey,
  marking: Marking,
  answer: ScoredAnswer,
): { result: QuestionResult; marks: number } {
  if (key.dropped) return { result: 'DROPPED', marks: marking.marks };
  if (!answer) return { result: 'UNANSWERED', marks: 0 };
  const wrong = { result: 'INCORRECT' as const, marks: penalty(marking) };

  if (key.kernel === 'SINGLE_CHOICE' || key.kernel === 'MULTI_CHOICE') {
    const chosen = [...new Set(answer.choice ?? [])];
    if (chosen.length === 0) return { result: 'UNANSWERED', marks: 0 };
    const correct = new Set((key.options ?? []).flatMap((o, i) => (o.isCorrect ? [i] : [])));

    if (key.kernel === 'SINGLE_CHOICE') {
      // Several accepted options (an NTA bonus) means any one of them is right.
      return chosen.length === 1 && correct.has(chosen[0]) ? { result: 'CORRECT', marks: marking.marks } : wrong;
    }
    if (chosen.some((i) => !correct.has(i))) return wrong;
    if (chosen.length === correct.size) return { result: 'CORRECT', marks: marking.marks };
    // JEE Advanced partial marking: +1 for each correct option chosen, when no wrong option is chosen.
    return marking.partialMarking ? { result: 'PARTIAL', marks: chosen.length } : wrong;
  }

  if (key.kernel === 'NUMERIC') {
    const cfg = key.answerConfig ?? {};
    const given = answer.value;
    if (typeof given !== 'number' || typeof cfg.value !== 'number') return { result: 'UNANSWERED', marks: 0 };
    if (cfg.integerOnly && !Number.isInteger(given)) return wrong;
    return Math.abs(given - cfg.value) <= (cfg.tolerance ?? 0) + EPSILON
      ? { result: 'CORRECT', marks: marking.marks }
      : wrong;
  }

  return { result: 'UNANSWERED', marks: 0 };
}

/** The result every saved answer would have had, and whether the student moved away from a right answer. */
export function historyInsight(key: AnswerKey, marking: Marking, history: { t: number; answer: ScoredAnswer }[]) {
  const results = history.map((h) => ({ t: h.t, result: h.answer ? scoreQuestion(key, marking, h.answer).result : ('UNANSWERED' as QuestionResult) }));
  const answered = results.filter((r) => r.result !== 'UNANSWERED').map((r) => r.result);
  let changedCorrectToWrong = false;
  let changedWrongToCorrect = false;
  for (let i = 1; i < answered.length; i++) {
    if (answered[i - 1] === 'CORRECT' && answered[i] === 'INCORRECT') changedCorrectToWrong = true;
    if (answered[i - 1] === 'INCORRECT' && answered[i] === 'CORRECT') changedWrongToCorrect = true;
  }
  return { results, changedCorrectToWrong, changedWrongToCorrect };
}

/** What an unsaved selection would have scored (the "right answer, never saved" insight). */
export function draftResult(
  key: AnswerKey,
  marking: Marking,
  draft: { choice?: number[]; text?: string } | null,
): QuestionResult {
  if (!draft) return 'UNANSWERED';
  if (Array.isArray(draft.choice)) {
    return draft.choice.length ? scoreQuestion({ ...key, dropped: false }, marking, { choice: draft.choice }).result : 'UNANSWERED';
  }
  const value = typeof draft.text === 'string' ? parseNumericAnswer(draft.text) : null;
  return value === null ? 'UNANSWERED' : scoreQuestion({ ...key, dropped: false }, marking, { value }).result;
}

const emptyTotals = (): Totals => ({
  total: 0, maxMarks: 0, gained: 0, deducted: 0, correct: 0, incorrect: 0, partial: 0, dropped: 0,
  attempted: 0, skipped: 0, notSeen: 0, notEvaluated: 0, accuracy: 0,
});

export function scoreAttempt(sheet: SheetRow[], states: Record<string, AttemptQuestionState>): AttemptScore {
  const rows = [...sheet].sort((a, b) => a.orderIndex - b.orderIndex);
  const overall = emptyTotals();
  const subjects: Record<string, Totals> = {};
  const sections: Record<string, Totals> = {};
  const questions: AttemptScore['questions'] = {};
  const sectionKey = (r: SheetRow) => r.sectionId ?? 'default';

  // Maximum marks: each row contributes (attempt limit, else its question count) x marks.
  const rowsById = new Map<string, SheetRow[]>();
  for (const r of rows) rowsById.set(r.marking.rowId, [...(rowsById.get(r.marking.rowId) ?? []), r]);
  for (const group of rowsById.values()) {
    const { attemptLimit, marks } = group[0].marking;
    const max = Math.min(attemptLimit ?? group.length, group.length) * marks;
    (subjects[group[0].subjectName] ??= emptyTotals()).maxMarks += max;
    (sections[sectionKey(group[0])] ??= emptyTotals()).maxMarks += max;
    overall.maxMarks += max;
  }

  const evaluatedInRow = new Map<string, number>();
  for (const row of rows) {
    const state = states[row.questionId] ?? { status: 'NOT_VISITED', answer: null };
    const buckets = [(subjects[row.subjectName] ??= emptyTotals()), (sections[sectionKey(row)] ??= emptyTotals()), overall];
    const marking = { maxMarks: row.marking.marks, negativeMarks: row.marking.negativeMarks };
    const answered = state.answer !== null && state.answer !== undefined;

    if (row.key.dropped) {
      questions[row.questionId] = { result: 'DROPPED', marks: row.marking.marks, evaluated: true, ...marking };
      for (const b of buckets) {
        b.dropped++;
        b.total += row.marking.marks;
        b.gained += row.marking.marks;
      }
      continue;
    }

    if (!answered) {
      questions[row.questionId] = { result: 'UNANSWERED', marks: 0, evaluated: false, ...marking };
      for (const b of buckets) {
        if (state.status === 'NOT_VISITED') b.notSeen++;
        else b.skipped++;
      }
      continue;
    }

    const used = evaluatedInRow.get(row.marking.rowId) ?? 0;
    if (row.marking.attemptLimit !== null && used >= row.marking.attemptLimit) {
      questions[row.questionId] = { result: 'NOT_EVALUATED', marks: 0, evaluated: false, ...marking };
      for (const b of buckets) b.notEvaluated++;
      continue;
    }
    evaluatedInRow.set(row.marking.rowId, used + 1);

    const { result, marks } = scoreQuestion(row.key, row.marking, state.answer);
    questions[row.questionId] = { result, marks, evaluated: true, ...marking };
    for (const b of buckets) {
      b.attempted++;
      b.total += marks;
      if (marks > 0) b.gained += marks;
      if (marks < 0) b.deducted += marks;
      if (result === 'CORRECT') b.correct++;
      else if (result === 'PARTIAL') b.partial++;
      else if (result === 'INCORRECT') b.incorrect++;
    }
  }

  for (const b of [overall, ...Object.values(subjects), ...Object.values(sections)]) {
    b.total = round2(b.total) + 0;
    b.gained = round2(b.gained) + 0;
    b.deducted = round2(b.deducted) + 0;
    b.maxMarks = round2(b.maxMarks);
    b.accuracy = b.attempted > 0 ? round2((b.correct / b.attempted) * 100) : 0;
  }

  return { ...overall, subjects, sections, questions };
}
