import type { FormatShape, FormatRowShape } from './test-format.logic';

/**
 * Platform templates. Institutes copy these into their own formats, matching
 * subjects by name and question types by code.
 *
 * These follow recent official patterns but exams change them, often yearly --
 * JEE Advanced most of all, whose section shapes below are a representative
 * sample rather than any one year's exact paper. Every template carries a note
 * saying so, and none ships percentile bands: those are an institute's own
 * estimate.
 */

export const TEMPLATE_NOTE =
  'Based on a recent official pattern -- review before use.';

export interface FormatTemplate extends FormatShape {
  instructionsHtml: string;
}

const row = (
  questionTypeCode: string,
  kernel: string,
  questionCount: number,
  marksPerQuestion: number,
  negativeMarks: number,
  partialMarking = false,
): FormatRowShape => ({
  questionTypeCode,
  kernel,
  questionCount,
  marksPerQuestion,
  negativeMarks,
  partialMarking,
});

const SCQ = (n: number, marks: number, neg: number) => row('SCQ', 'SINGLE_CHOICE', n, marks, neg);
const MCQ = (n: number, marks: number, neg: number) => row('MCQ', 'MULTI_CHOICE', n, marks, neg, true);
const NAT = (n: number, marks: number, neg: number) => row('NAT', 'NUMERIC', n, marks, neg);

const jeeMainSubject = (subjectName: string) => ({
  subjectName,
  totalQuestions: 25,
  totalMarks: 100,
  sections: [
    { name: 'Section A', rows: [SCQ(20, 4, 1)] },
    { name: 'Section B', rows: [NAT(5, 4, 1)] },
  ],
});

const jeeAdvancedSubject = (subjectName: string) => ({
  subjectName,
  totalQuestions: 17,
  totalMarks: 60,
  sections: [
    { name: 'Section 1', rows: [SCQ(4, 3, 1)] },
    { name: 'Section 2', rows: [MCQ(3, 4, 2)] },
    { name: 'Section 3', rows: [NAT(6, 4, 0)] },
    { name: 'Section 4', rows: [SCQ(4, 3, 1)] },
  ],
});

const neetSubject = (subjectName: string, questions: number) => ({
  subjectName,
  totalQuestions: questions,
  totalMarks: questions * 4,
  sections: [{ name: 'Section A', rows: [SCQ(questions, 4, 1)] }],
});

const jeeAdvanced = (paper: 1 | 2): FormatTemplate => ({
  name: `JEE Advanced Paper ${paper}`,
  durationMinutes: 180,
  instructionsHtml:
    `<p>Paper ${paper} of 2. Three subjects, four sections each. ` +
    'Section 2 awards partial marks for multiple-correct questions.</p>',
  subjects: ['Physics', 'Chemistry', 'Mathematics'].map(jeeAdvancedSubject),
  bands: [],
});

export const FORMAT_TEMPLATES: FormatTemplate[] = [
  {
    name: 'JEE Main',
    durationMinutes: 180,
    instructionsHtml:
      '<p>Three subjects. Section A: single-correct, +4 / −1. ' +
      'Section B: numerical answer, +4 / −1.</p>',
    subjects: ['Physics', 'Chemistry', 'Mathematics'].map(jeeMainSubject),
    bands: [],
  },
  jeeAdvanced(1),
  jeeAdvanced(2),
  {
    name: 'NEET UG',
    durationMinutes: 180,
    instructionsHtml: '<p>All questions single-correct, +4 / −1.</p>',
    subjects: [
      neetSubject('Physics', 45),
      neetSubject('Chemistry', 45),
      neetSubject('Biology', 90),
    ],
    bands: [],
  },
];
