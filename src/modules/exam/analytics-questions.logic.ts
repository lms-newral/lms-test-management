/**
 * One row of the Question-wise Review: what the student did on a question, set
 * against what everyone else did with it.
 *
 * A question nobody else reached compares to nothing — those fields are null, so
 * the table never implies the class scored zero on it.
 *
 * Pure. Spec: test/exam/analytics-compare.test.js.
 */

export interface AttemptQuestionFacts {
  questionId: string;
  subjectName: string | null;
  chapterName?: string | null;
  topicName?: string | null;
  difficulty?: string | null;
  status: string;
  result: string;
  marks: number;
  timeMs: number;
  visits: number;
  answerChanges: number;
}

export interface QuestionStat {
  attempts: number;
  correct: number;
  avgTimeMs: number | null;
  topperAvgTimeMs: number | null;
  topperAccuracy: number | null;
}

export interface ReviewRow extends AttemptQuestionFacts {
  classAccuracy: number | null;
  topperAccuracy: number | null;
  timeVsClassMs: number | null;
  timeVsTopperMs: number | null;
  slowerThanClass: boolean | null;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function reviewRow(
  question: AttemptQuestionFacts,
  stat: QuestionStat | null,
): ReviewRow {
  const attempts = stat?.attempts ?? 0;
  const classTime = stat?.avgTimeMs ?? null;
  const topperTime = stat?.topperAvgTimeMs ?? null;
  return {
    ...question,
    classAccuracy:
      attempts > 0 ? round2(((stat?.correct ?? 0) / attempts) * 100) : null,
    topperAccuracy: stat?.topperAccuracy ?? null,
    timeVsClassMs: classTime !== null ? question.timeMs - classTime : null,
    timeVsTopperMs: topperTime !== null ? question.timeMs - topperTime : null,
    slowerThanClass: classTime !== null ? question.timeMs > classTime : null,
  };
}
