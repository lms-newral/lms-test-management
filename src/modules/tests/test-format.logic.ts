/**
 * Pure rules for test formats and tests. No Nest, no Prisma: numbers in,
 * readable problems out, so every rule is testable offline and the admin UI can
 * mirror the same arithmetic.
 *
 * Validation returns a list of human-readable problems rather than throwing on
 * the first one, so a teacher building a 3-subject format sees everything that
 * is wrong at once instead of fixing one field per save.
 */

export const MAX_DURATION_MINUTES = 1440;

/** The only kernel where partial marking has a meaning: several correct options. */
export const PARTIAL_MARKING_KERNEL = 'MULTI_CHOICE';

/** Shown when a used format is edited. */
export const LOCKED_FORMAT_MESSAGE =
  'This format is used by a test, so its structure can no longer change -- ' +
  'existing scores and analytics depend on it. Duplicate it to make a new version.';

/** Fields a published test may still change. Everything else is frozen. */
export const PUBLISHED_EDITABLE_FIELDS = [
  'name',
  'descriptionHtml',
  'plannerFileKey',
  'plannerFileName',
] as const;

export interface FormatRowShape {
  questionTypeCode: string;
  kernel: string;
  questionCount: number;
  attemptLimit?: number | null;
  marksPerQuestion: number;
  negativeMarks: number;
  partialMarking: boolean;
}

export interface FormatSectionShape {
  name: string;
  rows: FormatRowShape[];
}

export interface FormatSubjectShape {
  subjectId?: string | null;
  subjectName: string;
  totalQuestions: number;
  totalMarks: number;
  sections: FormatSectionShape[];
}

export interface PercentileBandShape {
  minScore: number;
  maxScore: number;
  percentile: number;
}

export interface FormatShape {
  name: string;
  durationMinutes: number;
  subjects: FormatSubjectShape[];
  bands: PercentileBandShape[];
}

/** Marks are money-like: always compared at two decimals. */
export const round2 = (n: number): number => Math.round(n * 100) / 100;

const hasTwoDecimals = (n: number) =>
  Number.isFinite(n) && Math.abs(round2(n) - n) < 1e-9;

/** Questions a student can actually answer in this row. */
export const rowAnswerable = (row: FormatRowShape): number =>
  row.attemptLimit ?? row.questionCount;

/** Best possible marks from a row. */
export const rowMaxMarks = (row: FormatRowShape): number =>
  round2(rowAnswerable(row) * row.marksPerQuestion);

/** Worst possible marks from a row (every answered question wrong), as a positive number. */
export const rowMaxNegative = (row: FormatRowShape): number =>
  round2(rowAnswerable(row) * row.negativeMarks);

const rows = (subject: FormatSubjectShape) =>
  subject.sections.flatMap((s) => s.rows);

export function subjectTotals(subject: FormatSubjectShape) {
  const all = rows(subject);
  return {
    questions: all.reduce((n, r) => n + r.questionCount, 0),
    marks: round2(all.reduce((n, r) => n + rowMaxMarks(r), 0)),
    maxNegative: round2(all.reduce((n, r) => n + rowMaxNegative(r), 0)),
  };
}

export function formatTotals(format: Pick<FormatShape, 'subjects'>) {
  const per = format.subjects.map(subjectTotals);
  const marks = round2(per.reduce((n, t) => n + t.marks, 0));
  const maxNegative = round2(per.reduce((n, t) => n + t.maxNegative, 0));
  return {
    questions: per.reduce((n, t) => n + t.questions, 0),
    marks,
    /** The lowest score possible: every answerable question attempted and wrong. */
    minScore: maxNegative === 0 ? 0 : -maxNegative,
  };
}

/**
 * Everything wrong with a format, for making it ACTIVE. An empty list means the
 * format can be used to build tests. A DRAFT may be saved with problems.
 */
export function validateFormat(format: FormatShape): string[] {
  const problems: string[] = [];
  const add = (p: string) => problems.push(p);

  if (!format.name?.trim()) add('Give the format a name.');
  if (
    !Number.isInteger(format.durationMinutes) ||
    format.durationMinutes < 1 ||
    format.durationMinutes > MAX_DURATION_MINUTES
  ) {
    add(`Duration must be a whole number of minutes between 1 and ${MAX_DURATION_MINUTES}.`);
  }

  if (format.subjects.length === 0) add('Add at least one subject.');

  const seenSubjects = new Set<string>();
  for (const subject of format.subjects) {
    const s = subject.subjectName || 'Untitled subject';
    const key = subject.subjectId ?? subject.subjectName.trim().toLowerCase();
    if (seenSubjects.has(key)) add(`${s} is added more than once.`);
    seenSubjects.add(key);

    if (subject.sections.length === 0) add(`${s}: add at least one section.`);

    subject.sections.forEach((section, si) => {
      const sec = `${s} › ${section.name?.trim() || `Section ${si + 1}`}`;
      if (!section.name?.trim()) add(`${sec}: give the section a name.`);
      if (section.rows.length === 0) add(`${sec}: add at least one question row.`);

      section.rows.forEach((row, ri) => {
        const r = `${sec} › row ${ri + 1} (${row.questionTypeCode || 'no type'})`;
        if (!row.questionTypeCode) add(`${r}: choose a question type.`);
        if (!Number.isInteger(row.questionCount) || row.questionCount < 1) {
          add(`${r}: number of questions must be a whole number of at least 1.`);
        }
        if (!(row.marksPerQuestion > 0) || !hasTwoDecimals(row.marksPerQuestion)) {
          add(`${r}: marks per question must be more than 0, with at most 2 decimals.`);
        }
        if (!(row.negativeMarks >= 0) || !hasTwoDecimals(row.negativeMarks)) {
          add(`${r}: negative marks must be 0 or more, with at most 2 decimals.`);
        } else if (row.negativeMarks > row.marksPerQuestion) {
          add(`${r}: negative marks (${row.negativeMarks}) cannot be more than marks per question (${row.marksPerQuestion}).`);
        }
        if (row.attemptLimit != null) {
          if (
            !Number.isInteger(row.attemptLimit) ||
            row.attemptLimit < 1 ||
            row.attemptLimit > row.questionCount
          ) {
            add(`${r}: "attempt at most" must be between 1 and ${row.questionCount}.`);
          }
        }
        if (row.partialMarking && row.kernel !== PARTIAL_MARKING_KERNEL) {
          add(`${r}: partial marking only applies to multiple-correct questions.`);
        }
      });
    });

    const totals = subjectTotals(subject);
    if (!Number.isInteger(subject.totalQuestions) || subject.totalQuestions < 1) {
      add(`${s}: total questions must be a whole number of at least 1.`);
    } else if (totals.questions !== subject.totalQuestions) {
      add(`${s}: rows add up to ${totals.questions} questions, but the subject total is ${subject.totalQuestions}.`);
    }
    if (!(subject.totalMarks > 0) || !hasTwoDecimals(subject.totalMarks)) {
      add(`${s}: total marks must be more than 0, with at most 2 decimals.`);
    } else if (totals.marks !== round2(subject.totalMarks)) {
      add(`${s}: rows add up to ${totals.marks} marks, but the subject total is ${subject.totalMarks}.`);
    }
  }

  problems.push(...validateBands(format));
  return problems;
}

/** Percentile bands over the whole test score. Gaps are allowed; overlaps are not. */
export function validateBands(format: Pick<FormatShape, 'subjects' | 'bands'>): string[] {
  const problems: string[] = [];
  const { marks, minScore } = formatTotals(format);
  const sorted = [...format.bands].sort((a, b) => a.minScore - b.minScore);

  sorted.forEach((band, i) => {
    const b = `Percentile band ${band.minScore}–${band.maxScore}`;
    if (![band.minScore, band.maxScore, band.percentile].every(hasTwoDecimals)) {
      problems.push(`${b}: use numbers with at most 2 decimals.`);
      return;
    }
    if (band.minScore > band.maxScore) problems.push(`${b}: the lower score is above the upper score.`);
    if (band.minScore < minScore || band.maxScore > marks) {
      problems.push(`${b}: scores must stay between ${minScore} and ${marks}.`);
    }
    if (band.percentile < 0 || band.percentile > 100) {
      problems.push(`${b}: percentile must be between 0 and 100.`);
    }
    const prev = sorted[i - 1];
    if (prev) {
      if (band.minScore <= prev.maxScore) {
        problems.push(`${b} overlaps ${prev.minScore}–${prev.maxScore}.`);
      }
      if (band.percentile < prev.percentile) {
        problems.push(`${b}: a higher score cannot have a lower percentile than ${prev.minScore}–${prev.maxScore}.`);
      }
    }
  });
  return problems;
}

/** Predicted percentile for a total score, or null where no band covers it. */
export function predictPercentile(
  bands: PercentileBandShape[],
  score: number,
): number | null {
  const band = bands.find((b) => score >= b.minScore && score <= b.maxScore);
  return band ? band.percentile : null;
}

/** Null when a format may still change; otherwise why not. */
export function formatLockReason(testsUsingFormat: number): string | null {
  return testsUsingFormat > 0 ? LOCKED_FORMAT_MESSAGE : null;
}

/** Null when a published test may apply these field changes; otherwise why not. */
export function publishedEditProblem(changedFields: string[]): string | null {
  const allowed = new Set<string>(PUBLISHED_EDITABLE_FIELDS);
  const blocked = changedFields.filter((f) => !allowed.has(f));
  return blocked.length
    ? `This test is published, so ${blocked.join(', ')} can no longer change. Unpublish it first (only possible before anyone attempts it).`
    : null;
}

// ─── Question picking and publishing ─────────────────────────────────────────

export interface RowSlot {
  rowId: string;
  /** e.g. "Physics › Section A › SCQ" */
  label: string;
  subjectId: string | null;
  questionTypeId: string | null;
  questionCount: number;
}

export interface PickCandidate {
  questionId: string;
  subjectId: string | null;
  questionTypeId: string | null;
  deleted: boolean;
}

/** Null when this question may be added to this row; otherwise why not. */
export function pickProblem(
  row: RowSlot,
  alreadyInRow: number,
  question: PickCandidate,
  alreadyInTest: boolean,
): string | null {
  if (question.deleted) return 'This question has been deleted from the bank.';
  if (alreadyInTest) return 'This question is already in the test.';
  if (!row.subjectId || question.subjectId !== row.subjectId) {
    return `This question is not filed under the subject of ${row.label}.`;
  }
  if (!row.questionTypeId || question.questionTypeId !== row.questionTypeId) {
    return `This question's type does not match ${row.label}.`;
  }
  if (alreadyInRow >= row.questionCount) {
    return `${row.label} already has all ${row.questionCount} questions.`;
  }
  return null;
}

export interface PlacedQuestion extends PickCandidate {
  rowId: string;
}

/** Everything stopping publish. Empty = the test can be published. */
export function publishProblems(
  status: string,
  slots: RowSlot[],
  placed: PlacedQuestion[],
): string[] {
  const problems: string[] = [];
  if (status !== 'DRAFT') problems.push('Only a draft test can be published.');

  for (const slot of slots) {
    const inRow = placed.filter((p) => p.rowId === slot.rowId);
    if (inRow.length !== slot.questionCount) {
      problems.push(`${slot.label}: ${inRow.length} of ${slot.questionCount} questions picked.`);
    }
    for (const q of inRow) {
      if (q.deleted) {
        problems.push(`${slot.label}: a picked question has since been deleted from the bank.`);
      } else if (q.subjectId !== slot.subjectId || q.questionTypeId !== slot.questionTypeId) {
        problems.push(`${slot.label}: a picked question's subject or type was changed in the bank.`);
      }
    }
  }

  const ids = placed.map((p) => p.questionId);
  if (new Set(ids).size !== ids.length) problems.push('The same question is placed twice.');
  return problems;
}

// ─── Test details ────────────────────────────────────────────────────────────

export interface TestDetailsShape {
  name: string;
  year: number | null;
  descriptionHtml: string | null;
  /** One per format subject, in paper order. */
  syllabi: { subjectName: string; syllabusHtml: string | null }[];
}

/** Visible text of editor HTML, so an empty paragraph does not count as written. */
export const visibleText = (html: string | null) =>
  (html ?? '')
    .replace(/<img\b[^>]*>/gi, ' image ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .trim();

/** Details and syllabus a test needs before it can be published. */
export function detailProblems(t: TestDetailsShape): string[] {
  const problems: string[] = [];
  if (!t.name?.trim()) problems.push('Give the test a name.');
  if (!t.year) problems.push('Add the test year.');
  if (!visibleText(t.descriptionHtml)) problems.push('Write a description for the test.');
  for (const s of t.syllabi) {
    if (!visibleText(s.syllabusHtml)) problems.push('Write the syllabus for ' + s.subjectName + '.');
  }
  return problems;
}
