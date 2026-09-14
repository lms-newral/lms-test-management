import { Prisma } from '@prisma/client';

/**
 * What a published test freezes about each question, stored in
 * QuestionUsage.snapshot. The exam player and every later score read this, not
 * the live bank row, so editing the bank can never change a published paper.
 *
 * Bump SNAPSHOT_VERSION if the shape changes, so readers can tell old from new.
 */
export const SNAPSHOT_VERSION = 1;

export const SNAPSHOT_INCLUDE = {
  typeDef: true,
  subject: true,
  chapter: true,
  topic: true,
  subtopic: true,
  difficultyLevel: true,
  solutions: {
    where: { deletedAt: null },
    orderBy: [{ orderIndex: 'asc' as const }],
  },
} satisfies Prisma.QuestionInclude;

export type QuestionForSnapshot = Prisma.QuestionGetPayload<{
  include: typeof SNAPSHOT_INCLUDE;
}>;

export interface SnapshotRow {
  id: string;
  questionTypeCode: string;
  kernel: string;
  marksPerQuestion: Prisma.Decimal | number;
  negativeMarks: Prisma.Decimal | number;
  partialMarking: boolean;
  attemptLimit: number | null;
}

const node = (t: { id: string; name: string } | null) =>
  t ? { id: t.id, name: t.name } : null;

export function buildQuestionSnapshot(
  q: QuestionForSnapshot,
  row: SnapshotRow,
): Prisma.InputJsonValue {
  return {
    snapshotVersion: SNAPSHOT_VERSION,
    questionId: q.id,
    version: q.currentVersion,
    questionText: q.questionText,
    type: q.typeDef
      ? {
          id: q.typeDef.id,
          code: q.typeDef.code,
          label: q.typeDef.label,
          kernel: q.typeDef.kernel,
        }
      : null,
    mcqOptions: q.mcqOptions ?? null,
    answerConfig: q.answerConfig ?? null,
    explanation: q.explanation ?? null,
    solutions: q.solutions.map((s) => ({
      kind: s.kind,
      contentHtml: s.contentHtml,
      videoProvider: s.videoProvider,
      videoUrl: s.videoUrl,
      visibility: s.visibility,
      orderIndex: s.orderIndex,
    })),
    taxonomy: {
      subject: node(q.subject),
      chapter: node(q.chapter),
      topic: node(q.topic),
      subtopic: node(q.subtopic),
    },
    difficulty: q.difficultyLevel
      ? {
          id: q.difficultyLevel.id,
          code: q.difficultyLevel.code,
          label: q.difficultyLevel.label,
        }
      : null,
    marking: {
      rowId: row.id,
      questionTypeCode: row.questionTypeCode,
      kernel: row.kernel,
      marks: Number(row.marksPerQuestion),
      negativeMarks: Number(row.negativeMarks),
      partialMarking: row.partialMarking,
      attemptLimit: row.attemptLimit,
    },
  } as Prisma.InputJsonValue;
}
