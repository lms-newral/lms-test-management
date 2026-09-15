import { Injectable, NotFoundException } from '@nestjs/common';
import { createCipheriv, randomBytes } from 'crypto';
import { PrismaService } from 'src/prisma/prisma.service';
import { S3Service } from 'src/common/services/s3.service';
import { FORMAT_INCLUDE } from '../tests/test-formats.service';
import type { Paper } from './attempt-replay.logic';
import type { SheetRow } from './attempt-scoring.logic';

/** What the student downloads: the paper without any answer key. */
export interface StudentPaper {
  testId: string;
  testName: string;
  durationMinutes: number;
  instructionsHtml: string | null;
  sections: { id: string; subjectName: string; name: string; instructionsHtml: string | null }[];
  questions: {
    id: string;
    sectionId: string;
    kernel: string;
    typeCode: string;
    optionCount: number;
    text: string;
    options: { text: string }[];
    marks: number;
    negativeMarks: number;
    partialMarking: boolean;
  }[];
}

/** Everything the server needs to score a test, built from the frozen snapshots. */
export interface FrozenPaper {
  student: StudentPaper;
  replay: Paper;
  sheet: SheetRow[];
  meta: Record<string, {
    sectionId: string;
    sectionName: string;
    subjectName: string;
    orderIndex: number;
    typeCode: string;
    chapterId: string | null;
    chapterName: string | null;
    topicId: string | null;
    topicName: string | null;
    subtopicId: string | null;
    subtopicName: string | null;
    difficulty: string | null;
  }>;
}

interface Snapshot {
  questionText?: string;
  type?: { code?: string; kernel?: string } | null;
  mcqOptions?: unknown;
  answerConfig?: Record<string, unknown> | null;
  taxonomy?: { chapter?: { id: string; name?: string } | null; topic?: { id: string; name?: string } | null; subtopic?: { id: string; name?: string } | null };
  /** Set by answer-key correction: an NTA dropped question. */
  dropped?: boolean;
  difficulty?: { code?: string } | null;
  marking?: { rowId?: string; kernel?: string; questionTypeCode?: string; marks?: number; negativeMarks?: number; partialMarking?: boolean; attemptLimit?: number | null };
}

const optionsOf = (stored: unknown): { text?: string; isCorrect?: boolean }[] => {
  if (Array.isArray(stored)) return stored as { text?: string; isCorrect?: boolean }[];
  const list = (stored as { options?: unknown } | null)?.options;
  return Array.isArray(list) ? (list as { text?: string; isCorrect?: boolean }[]) : [];
};

/**
 * Builds a published test's paper from QuestionUsage snapshots (never the live
 * bank), and stores the student copy encrypted in object storage. The key is
 * handed out only when an attempt starts.
 */
@Injectable()
export class ExamPaperService {
  private readonly cache = new Map<string, { at: number; paper: FrozenPaper }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
  ) {}

  async frozenPaper(testId: string): Promise<FrozenPaper> {
    const hit = this.cache.get(testId);
    if (hit && Date.now() - hit.at < 5 * 60_000) return hit.paper;

    const test = await this.prisma.test.findUnique({
      where: { id: testId },
      include: { format: { include: FORMAT_INCLUDE } },
    });
    if (!test) throw new NotFoundException('Test not found');
    const usages = await this.prisma.questionUsage.findMany({
      where: { usedInType: 'TEST', usedInId: testId },
      orderBy: [{ orderIndex: 'asc' }],
    });

    const rows = new Map<string, { sectionId: string; sectionName: string; subjectName: string; sectionInstructions: string | null }>();
    const sections: StudentPaper['sections'] = [];
    for (const subject of test.format.subjects) {
      for (const section of subject.sections) {
        sections.push({
          id: section.id,
          subjectName: subject.subjectName,
          name: section.name,
          instructionsHtml: section.instructionsHtml ?? null,
        });
        for (const row of section.rows) {
          rows.set(row.id, { sectionId: section.id, sectionName: section.name, subjectName: subject.subjectName, sectionInstructions: section.instructionsHtml ?? null });
        }
      }
    }

    const student: StudentPaper['questions'] = [];
    const sheet: SheetRow[] = [];
    const meta: FrozenPaper['meta'] = {};
    for (const usage of usages) {
      const snap = (usage.snapshot ?? {}) as Snapshot;
      const marking = snap.marking ?? {};
      const row = marking.rowId ? rows.get(marking.rowId) : undefined;
      if (!row) continue;
      const kernel = marking.kernel ?? snap.type?.kernel ?? 'SINGLE_CHOICE';
      const options = optionsOf(snap.mcqOptions);
      const marks = Number(marking.marks ?? usage.marks ?? 0);
      const negativeMarks = Number(marking.negativeMarks ?? usage.negativeMarks ?? 0);

      student.push({
        id: usage.questionId,
        sectionId: row.sectionId,
        kernel,
        typeCode: marking.questionTypeCode ?? snap.type?.code ?? '',
        optionCount: options.length,
        text: snap.questionText ?? '',
        options: options.map((o) => ({ text: o.text ?? '' })),
        marks,
        negativeMarks,
        partialMarking: !!marking.partialMarking,
      });
      sheet.push({
        questionId: usage.questionId,
        subjectName: row.subjectName,
        orderIndex: usage.orderIndex,
        sectionId: row.sectionId,
        key: { kernel, options: options.map((o) => ({ isCorrect: !!o.isCorrect })), answerConfig: (snap.answerConfig ?? null) as SheetRow['key']['answerConfig'], dropped: snap.dropped === true },
        marking: { marks, negativeMarks, partialMarking: !!marking.partialMarking, attemptLimit: marking.attemptLimit ?? null, rowId: marking.rowId! },
      });
      meta[usage.questionId] = {
        sectionId: row.sectionId,
        sectionName: row.sectionName,
        subjectName: row.subjectName,
        orderIndex: usage.orderIndex,
        typeCode: marking.questionTypeCode ?? snap.type?.code ?? '',
        chapterId: snap.taxonomy?.chapter?.id ?? null,
        chapterName: snap.taxonomy?.chapter?.name ?? null,
        topicId: snap.taxonomy?.topic?.id ?? null,
        topicName: snap.taxonomy?.topic?.name ?? null,
        subtopicId: snap.taxonomy?.subtopic?.id ?? null,
        subtopicName: snap.taxonomy?.subtopic?.name ?? null,
        difficulty: snap.difficulty?.code ?? null,
      };
    }

    const usedSections = new Set(student.map((q) => q.sectionId));
    const paper: FrozenPaper = {
      student: {
        testId: test.id,
        testName: test.name,
        durationMinutes: test.durationMinutes ?? test.format.durationMinutes,
        instructionsHtml: test.format.instructionsHtml ?? null,
        sections: sections.filter((s) => usedSections.has(s.id)),
        questions: student,
      },
      replay: {
        sections: sections.filter((s) => usedSections.has(s.id)).map(({ id, subjectName, name }) => ({ id, subjectName, name })),
        questions: student.map(({ id, sectionId, kernel, optionCount }) => ({ id, sectionId, kernel, optionCount })),
      },
      sheet,
      meta,
    };
    this.cache.set(testId, { at: Date.now(), paper });
    return paper;
  }

  /**
   * A signed download link and the key for the encrypted student paper. The
   * encrypted object is built once per publish and reused by every student.
   */
  async paperAccess(testId: string, expiresInSeconds: number): Promise<{ url: string; secret: string }> {
    let test = await this.prisma.test.findUnique({ where: { id: testId }, select: { tenantId: true, paperKey: true, paperSecret: true } });
    if (!test) throw new NotFoundException('Test not found');

    if (!test.paperKey || !test.paperSecret) {
      const { student } = await this.frozenPaper(testId);
      const secret = randomBytes(32);
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', secret, iv);
      const data = Buffer.concat([cipher.update(JSON.stringify(student), 'utf8'), cipher.final(), cipher.getAuthTag()]);
      const key = `tenants/${test.tenantId}/tests/${testId}/paper/${Date.now()}.json`;
      await this.s3.uploadBuffer(
        Buffer.from(JSON.stringify({ alg: 'AES-GCM', iv: iv.toString('base64'), data: data.toString('base64') })),
        key,
        'application/json',
      );
      // Only the first builder wins; a concurrent build just leaves an unused object.
      await this.prisma.test.updateMany({
        where: { id: testId, paperKey: null },
        data: { paperKey: key, paperSecret: secret.toString('base64') },
      });
      test = await this.prisma.test.findUnique({ where: { id: testId }, select: { tenantId: true, paperKey: true, paperSecret: true } });
    }

    return {
      url: await this.s3.getPresignedGetUrl(test!.paperKey!, Math.min(Math.max(expiresInSeconds, 600), 7 * 86400)),
      secret: test!.paperSecret!,
    };
  }
}
