import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';

import { PrismaService } from 'src/prisma/prisma.service';
import { S3Service } from 'src/common/services/s3.service';
import { notDeleted } from 'src/prisma/soft-delete';

import { AnswerKernel, QuestionStatus } from '../question-bank.enums';
import { BankQuestionsService } from '../questions/bank-questions.service';
import { stemHash } from '../validation/normalize';
import {
  Issue,
  ParsedRow,
  Severity,
  parseDocxHtml,
  worstSeverity,
} from './docx-parser';
import { mapAnswer } from './import-mapping';
import {
  LEVEL_ORDER,
  NamedDef,
  ResolutionIndex,
  TaxonomyNodeLite,
} from './taxonomy-resolver';
import { LibreOfficeClient } from './libreoffice.client';

const execFileAsync = promisify(execFile);

/**
 * Word import, phase 2.
 *
 * TWO-PHASE ON PURPOSE. Parsing writes `QuestionImportRow` rows and stops;
 * nothing reaches `Question` until a human presses commit. That is the whole
 * design: a 400-question document with one bad column should be fixable in
 * review, not half-imported and half-not. It also means a crashed or killed
 * worker leaves a FAILED job and zero questions, which is the only outcome that
 * is safe to retry.
 *
 * This is a port and a hardening of `quizzes/quiz.service.ts`, not a greenfield
 * build. Three things are deliberately different from that code:
 *
 *   1. `--mathjax`, not `--mathml`. The bank editor stores LaTeX, so pandoc is
 *      asked for LaTeX. Do NOT change the flag in quiz.service.ts -- that path
 *      renders MathML and is frozen.
 *   2. `execFile` with an argv array, a timeout and a maxBuffer. The old code
 *      interpolates a user-supplied filename into a shell string with no
 *      timeout, which is both an injection surface and a way to wedge a worker.
 *   3. Image keys use a uuid. The old code prefixes `Date.now()` and later
 *      reverses that by stripping `^\d+_` off the basename, which collides.
 */

export const IMPORT_STATUS = {
  PARSING: 'PARSING',
  AWAITING_REVIEW: 'AWAITING_REVIEW',
  COMMITTING: 'COMMITTING',
  DONE: 'DONE',
  FAILED: 'FAILED',
} as const;
export type ImportStatus = (typeof IMPORT_STATUS)[keyof typeof IMPORT_STATUS];

/** The column is a plain String in the schema, so the states live here. */
export function isImportStatus(v: string): v is ImportStatus {
  return Object.prototype.hasOwnProperty.call(IMPORT_STATUS, v);
}

/** Pandoc on a large document is slow, but not this slow. */
const PANDOC_TIMEOUT_MS = 120_000;
const PANDOC_MAX_BUFFER = 32 * 1024 * 1024;
/** A .docx of questions is a few MB; 60 is generous and still bounded. */
const MAX_DOCX_BYTES = 60 * 1024 * 1024;
const LEGACY_IMAGE = /\.(wmf|emf)$/i;

interface RowDraft {
  rowIndex: number;
  raw: Prisma.InputJsonValue;
  questionTypeId: string | null;
  subjectId: string | null;
  chapterId: string | null;
  topicId: string | null;
  subtopicId: string | null;
  difficultyId: string | null;
  bodyHtml: string;
  optionsJson: Prisma.InputJsonValue | typeof Prisma.DbNull;
  answerConfig: Prisma.InputJsonValue | typeof Prisma.DbNull;
  solutionHtml: string | null;
  solutionVideoUrl: string | null;
  marks: number | null;
  severity: Severity;
  issues: Prisma.InputJsonValue;
  duplicateOfId: string | null;
}

@Injectable()
export class QuestionImportService {
  private readonly logger = new Logger(QuestionImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
    private readonly bankQuestions: BankQuestionsService,
    private readonly libreOffice: LibreOfficeClient,
  ) {}

  /* ─── Job lifecycle ─────────────────────────────────────────────────────── */

  /**
   * Creates the job row and hands back a presigned PUT.
   *
   * The client uploads straight to S3 rather than through GraphQL. The
   * `processWordToQuiz` mutation on the quiz path takes a `GraphQLUpload`, but
   * `graphqlUploadExpress` is not installed in main.ts, so that path cannot
   * actually work -- the presigned round trip is the one that does.
   */
  async createJob(
    fileName: string,
    questionBankId: string | undefined,
    userId: string,
    tenantId: string,
  ) {
    const job = await this.prisma.questionImportJob.create({
      data: {
        tenantId,
        createdById: userId,
        fileName,
        fileKey: '',
        questionBankId: questionBankId ?? null,
        status: IMPORT_STATUS.PARSING,
      },
    });

    const upload = await this.s3.getQuestionImportUploadUrl(
      tenantId,
      job.id,
      fileName,
    );

    await this.prisma.questionImportJob.update({
      where: { id: job.id },
      data: { fileKey: upload.key },
    });

    return { job: { ...job, fileKey: upload.key }, upload };
  }

  async findJob(id: string, tenantId: string) {
    const job = await this.prisma.questionImportJob.findFirst({
      where: { id, tenantId },
    });
    if (!job) throw new NotFoundException(`Import job not found: ${id}`);
    return job;
  }

  async listJobs(tenantId: string, limit = 20) {
    return this.prisma.questionImportJob.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(100, Math.max(1, limit)),
    });
  }

  /* ─── Parse ─────────────────────────────────────────────────────────────── */

  /**
   * Downloads, converts and stages one job. Runs in the BullMQ worker.
   *
   * Every failure path ends at FAILED with a reason a human can act on, and
   * leaves no `Question` rows behind. The temp directory is removed whatever
   * happens.
   */
  async parseJob(jobId: string, tenantId: string): Promise<void> {
    const job = await this.findJob(jobId, tenantId);
    if (!job.fileKey) {
      await this.failJob(jobId, 'The file was never uploaded.');
      return;
    }

    const tempDir = path.join(
      os.tmpdir(),
      `qb_import_${Date.now()}_${randomUUID()}`,
    );

    try {
      await this.prisma.questionImportJob.update({
        where: { id: jobId },
        data: { status: IMPORT_STATUS.PARSING, failureReason: null },
      });

      await fs.mkdir(tempDir, { recursive: true });

      const buffer = await this.s3.downloadFile(job.fileKey);
      if (buffer.byteLength > MAX_DOCX_BYTES) {
        await this.failJob(
          jobId,
          `The file is ${Math.round(buffer.byteLength / 1024 / 1024)} MB; the limit is ${MAX_DOCX_BYTES / 1024 / 1024} MB.`,
        );
        return;
      }

      const docxPath = path.join(tempDir, 'source.docx');
      const htmlPath = path.join(tempDir, 'source.html');
      const mediaDir = path.join(tempDir, 'media');
      await fs.writeFile(docxPath, buffer);

      await this.runPandoc(docxPath, htmlPath, mediaDir);
      const html = await fs.readFile(htmlPath, 'utf-8');

      const parsed = parseDocxHtml(html);
      const fatal = parsed.issues.filter((i) => i.severity === 'BLOCKING');
      if (fatal.length) {
        await this.failJob(jobId, fatal.map((f) => f.message).join(' '));
        return;
      }

      // Images: convert legacy formats, upload the rest, then rewrite srcs.
      const { urlBySrc, imageIssues } = await this.processImages(
        parsed.imageSources,
        tempDir,
        tenantId,
        jobId,
      );

      const index = await this.buildIndex(tenantId);
      const defaultType = await this.defaultChoiceType(tenantId);

      const drafts: RowDraft[] = [];
      const seenHashes = new Map<string, number>();

      for (const row of parsed.rows) {
        drafts.push(
          await this.stageRow(
            row,
            index,
            defaultType,
            urlBySrc,
            imageIssues,
            seenHashes,
            tenantId,
          ),
        );
      }

      await this.prisma.$transaction(async (tx) => {
        await tx.questionImportRow.deleteMany({ where: { jobId } });
        for (const d of drafts) {
          await tx.questionImportRow.create({
            data: { jobId, tenantId, ...d },
          });
        }
        await tx.questionImportJob.update({
          where: { id: jobId },
          data: {
            status: IMPORT_STATUS.AWAITING_REVIEW,
            parsedCount: drafts.length,
            report: {
              headers: parsed.headers,
              unknownHeaders: parsed.unknownHeaders,
              documentIssues: parsed.issues as unknown as Prisma.InputJsonValue,
              blocking: drafts.filter((d) => d.severity === 'BLOCKING').length,
              warning: drafts.filter((d) => d.severity === 'WARNING').length,
              ok: drafts.filter((d) => d.severity === 'OK').length,
            } as Prisma.InputJsonValue,
          },
        });
      });

      this.logger.log(
        `Import ${jobId}: staged ${drafts.length} row(s) for review`,
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.logger.error(`Import ${jobId} failed: ${message}`);
      await this.failJob(jobId, message);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  /**
   * Runs pandoc with an argv array, a timeout and a bounded buffer.
   *
   * `--mathjax` is the whole reason this is a separate invocation from the quiz
   * importer: it makes pandoc emit `\(latex\)`, which is what `MathNode` stores
   * and what `normalize.ts` hashes. `--mathml` would produce markup the editor
   * cannot make editable again.
   */
  private async runPandoc(
    docxPath: string,
    htmlPath: string,
    mediaDir: string,
  ): Promise<void> {
    try {
      await execFileAsync(
        'pandoc',
        [
          docxPath,
          '-f',
          'docx',
          '-t',
          'html5',
          '--mathjax',
          `--extract-media=${mediaDir}`,
          '-o',
          htmlPath,
        ],
        { timeout: PANDOC_TIMEOUT_MS, maxBuffer: PANDOC_MAX_BUFFER },
      );
    } catch (e) {
      const err = e as { killed?: boolean; stderr?: string; message?: string };
      if (err.killed) {
        throw new Error(
          `Converting the document timed out after ${PANDOC_TIMEOUT_MS / 1000}s.`,
        );
      }
      throw new Error(
        `Could not read the Word file: ${(err.stderr || err.message || '').trim().slice(0, 500)}`,
      );
    }
  }

  /**
   * Uploads extracted media and returns a src -> URL map.
   *
   * A WMF/EMF goes through the LibreOffice sidecar first. If that fails the
   * original is still uploaded and the row gets a WARNING -- the author needs to
   * know the figure needs replacing, which is strictly better than the current
   * quiz behaviour of dropping it and setting alt text nobody reads.
   */
  private async processImages(
    sources: string[],
    tempDir: string,
    tenantId: string,
    jobId: string,
  ): Promise<{ urlBySrc: Map<string, string>; imageIssues: Issue[] }> {
    const urlBySrc = new Map<string, string>();
    const imageIssues: Issue[] = [];

    for (const src of sources) {
      const abs = path.isAbsolute(src) ? src : path.join(tempDir, src);
      // Refuse anything that escapes the extraction directory.
      if (!path.resolve(abs).startsWith(path.resolve(tempDir))) {
        imageIssues.push({
          code: 'IMAGE_OUTSIDE_TEMP',
          severity: 'WARNING',
          message: `Ignored an image with a suspicious path: ${src}`,
        });
        continue;
      }

      let buffer: Buffer;
      try {
        buffer = await fs.readFile(abs);
      } catch {
        imageIssues.push({
          code: 'IMAGE_MISSING',
          severity: 'WARNING',
          message: `An image referenced by the document was not extracted: ${src}`,
        });
        continue;
      }

      let filename = path.basename(src);
      let contentType = this.contentTypeFor(filename);

      if (LEGACY_IMAGE.test(filename)) {
        const converted = await this.libreOffice.toPng(buffer, filename);
        if (converted.ok && converted.png) {
          buffer = converted.png;
          filename = filename.replace(LEGACY_IMAGE, '.png');
          contentType = 'image/png';
        } else {
          imageIssues.push({
            code: 'LEGACY_IMAGE_NOT_CONVERTED',
            severity: 'WARNING',
            message:
              converted.reason ??
              `"${filename}" is a legacy Word image that could not be converted.`,
          });
        }
      }

      // A uuid, not a timestamp: the quiz importer reverses its keys by
      // stripping a numeric prefix off the basename, which collides whenever
      // two documents contain the same filename in the same millisecond.
      const key =
        `tenants/${tenantId}/question-bank/imports/${jobId}/media/` +
        `${randomUUID()}-${filename.replace(/[^\w.-]+/g, '_')}`;

      try {
        const url = await this.s3.uploadBuffer(buffer, key, contentType);
        urlBySrc.set(src, url);
      } catch (e) {
        imageIssues.push({
          code: 'IMAGE_UPLOAD_FAILED',
          severity: 'WARNING',
          message: `Could not store "${filename}": ${e instanceof Error ? e.message : e}`,
        });
      }
    }

    return { urlBySrc, imageIssues };
  }

  private contentTypeFor(filename: string): string {
    const ext = path.extname(filename).toLowerCase();
    if (ext === '.png') return 'image/png';
    if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
    if (ext === '.gif') return 'image/gif';
    if (ext === '.svg') return 'image/svg+xml';
    if (ext === '.webp') return 'image/webp';
    return 'application/octet-stream';
  }

  /** Rewrites every local `src` to the uploaded URL. */
  private rewriteImages(html: string, urlBySrc: Map<string, string>): string {
    if (!html || urlBySrc.size === 0) return html;
    return html.replace(
      /(<img\b[^>]*\bsrc=")([^"]+)(")/gi,
      (match, before: string, src: string, after: string) => {
        const url = urlBySrc.get(src);
        return url ? `${before}${url}${after}` : match;
      },
    );
  }

  /* ─── Row staging ───────────────────────────────────────────────────────── */

  private async buildIndex(tenantId: string): Promise<ResolutionIndex> {
    const [nodes, types, difficulties] = await Promise.all([
      this.prisma.taxonomy.findMany({
        where: { tenantId, ...notDeleted(), isActive: true },
        select: { id: true, kind: true, name: true, code: true, parentId: true },
      }),
      this.prisma.questionTypeDef.findMany({
        where: { tenantId, ...notDeleted(), isActive: true },
        select: { id: true, code: true, label: true, aliases: true },
      }),
      this.prisma.difficultyLevel.findMany({
        where: { tenantId, ...notDeleted(), isActive: true },
        select: { id: true, code: true, label: true, aliases: true },
      }),
    ]);

    return new ResolutionIndex(
      nodes as TaxonomyNodeLite[],
      types as NamedDef[],
      difficulties as NamedDef[],
    );
  }

  /**
   * The type used when the document has no Type column.
   *
   * `QuestionImport.tsx` promises authors this defaults to Single Correct, so
   * this looks for exactly that and nothing clever.
   */
  private async defaultChoiceType(tenantId: string) {
    return this.prisma.questionTypeDef.findFirst({
      where: {
        tenantId,
        ...notDeleted(),
        isActive: true,
        kernel: AnswerKernel.SINGLE_CHOICE,
      },
      orderBy: [{ orderIndex: 'asc' }],
    });
  }

  private async stageRow(
    row: ParsedRow,
    index: ResolutionIndex,
    defaultType: { id: string; kernel: string; config: unknown } | null,
    urlBySrc: Map<string, string>,
    imageIssues: Issue[],
    seenHashes: Map<string, number>,
    tenantId: string,
  ): Promise<RowDraft> {
    const issues: Issue[] = [...row.issues];

    const bodyHtml = this.rewriteImages(row.bodyHtml, urlBySrc);
    const solutionHtml = row.explanationHtml
      ? this.rewriteImages(row.explanationHtml, urlBySrc)
      : null;

    // Image problems are document-wide, but a reviewer looks at rows -- so
    // attach them to any row that actually references a converted image.
    if (imageIssues.length && /<img/i.test(row.bodyHtml)) {
      issues.push(...imageIssues);
    }

    // Type
    let typeId: string | null = null;
    let kernel: AnswerKernel | null = null;
    let typeConfig: Record<string, unknown> | null = null;

    if (row.typeRaw) {
      const hit = index.resolveType(row.typeRaw);
      issues.push(...hit.issues);
      if (hit.id) {
        const def = await this.prisma.questionTypeDef.findFirst({
          where: { id: hit.id, tenantId },
          select: { id: true, kernel: true, config: true },
        });
        if (def) {
          typeId = def.id;
          kernel = def.kernel as AnswerKernel;
          typeConfig = (def.config ?? null) as Record<string, unknown> | null;
        }
      }
    } else if (defaultType) {
      typeId = defaultType.id;
      kernel = defaultType.kernel as AnswerKernel;
      typeConfig = (defaultType.config ?? null) as Record<string, unknown> | null;
    } else {
      issues.push({
        code: 'NO_DEFAULT_TYPE',
        severity: 'BLOCKING',
        message:
          'This row names no question type and no single-correct type is ' +
          'configured to fall back to.',
      });
    }

    // Taxonomy
    const taxonomy = index.resolvePath({
      subject: row.subjectRaw,
      chapter: row.chapterRaw,
      topic: row.topicRaw,
      subtopic: row.subtopicRaw,
    });
    issues.push(...taxonomy.issues);

    // Difficulty
    const difficulty = index.resolveDifficulty(row.difficultyRaw);
    issues.push(...difficulty.issues);

    // Answer
    let mcqOptions: Prisma.InputJsonValue | typeof Prisma.DbNull = Prisma.DbNull;
    let answerConfig: Prisma.InputJsonValue | typeof Prisma.DbNull =
      Prisma.DbNull;
    if (kernel) {
      const mapped = mapAnswer(kernel, { ...row, bodyHtml }, typeConfig);
      issues.push(...mapped.issues);
      if (mapped.mcqOptions) {
        mcqOptions = mapped.mcqOptions as unknown as Prisma.InputJsonValue;
      }
      if (mapped.answerConfig) {
        answerConfig = mapped.answerConfig as Prisma.InputJsonValue;
      }
    }

    // Duplicates -- against the live bank and against earlier rows in this job.
    let duplicateOfId: string | null = null;
    const hash = stemHash(bodyHtml);
    if (hash) {
      const earlier = seenHashes.get(hash);
      if (earlier !== undefined) {
        issues.push({
          code: 'DUPLICATE_IN_FILE',
          severity: 'WARNING',
          message: `This question also appears in row ${earlier} of this file.`,
        });
      } else {
        seenHashes.set(hash, row.rowIndex);
      }

      const existing = await this.prisma.question.findFirst({
        where: { tenantId, ...notDeleted(), normalizedHash: hash },
        select: { id: true },
      });
      if (existing) {
        duplicateOfId = existing.id;
        issues.push({
          code: 'DUPLICATE_IN_BANK',
          severity: 'WARNING',
          message:
            'A question with the same text already exists in the bank. ' +
            'Import anyway, or drop this row.',
        });
      }
    }

    return {
      rowIndex: row.rowIndex,
      raw: row.raw as unknown as Prisma.InputJsonValue,
      questionTypeId: typeId,
      subjectId: taxonomy.subjectId ?? null,
      chapterId: taxonomy.chapterId ?? null,
      topicId: taxonomy.topicId ?? null,
      subtopicId: taxonomy.subtopicId ?? null,
      difficultyId: difficulty.id ?? null,
      bodyHtml,
      optionsJson: mcqOptions,
      answerConfig,
      solutionHtml,
      solutionVideoUrl: row.solutionVideoUrl ?? null,
      marks: row.marks ?? null,
      severity: worstSeverity(issues),
      issues: issues as unknown as Prisma.InputJsonValue,
      duplicateOfId,
    };
  }

  private async failJob(jobId: string, reason: string): Promise<void> {
    await this.prisma.questionImportJob
      .update({
        where: { id: jobId },
        data: {
          status: IMPORT_STATUS.FAILED,
          failureReason: reason.slice(0, 2000),
        },
      })
      .catch(() => undefined);
  }

  /* ─── Review ────────────────────────────────────────────────────────────── */

  async listRows(
    jobId: string,
    tenantId: string,
    severity?: Severity,
    includeDropped = false,
  ) {
    await this.findJob(jobId, tenantId);
    return this.prisma.questionImportRow.findMany({
      where: {
        jobId,
        tenantId,
        ...(severity ? { severity } : {}),
        ...(includeDropped ? {} : { dropped: false }),
      },
      orderBy: { rowIndex: 'asc' },
    });
  }

  /**
   * Applies a reviewer's correction to one staged row.
   *
   * The correction is recorded in `overrides` as well as applied, so the
   * original parse stays readable next to it -- useful when a whole column was
   * mis-mapped and someone needs to see what the document actually said.
   */
  async updateRow(
    rowId: string,
    patch: {
      bodyHtml?: string;
      optionsJson?: unknown;
      answerConfig?: unknown;
      solutionHtml?: string | null;
      questionTypeId?: string | null;
      subjectId?: string | null;
      chapterId?: string | null;
      topicId?: string | null;
      subtopicId?: string | null;
      difficultyId?: string | null;
      marks?: number | null;
    },
    tenantId: string,
  ) {
    const row = await this.prisma.questionImportRow.findFirst({
      where: { id: rowId, tenantId },
    });
    if (!row) throw new NotFoundException(`Import row not found: ${rowId}`);

    const job = await this.findJob(row.jobId, tenantId);
    this.assertReviewable(job.status);

    const overrides = {
      ...((row.overrides as Record<string, unknown>) ?? {}),
      ...patch,
    };

    const updated = await this.prisma.questionImportRow.update({
      where: { id: rowId },
      data: {
        ...(patch.bodyHtml !== undefined ? { bodyHtml: patch.bodyHtml } : {}),
        ...(patch.optionsJson !== undefined
          ? { optionsJson: patch.optionsJson as Prisma.InputJsonValue }
          : {}),
        ...(patch.answerConfig !== undefined
          ? { answerConfig: patch.answerConfig as Prisma.InputJsonValue }
          : {}),
        ...(patch.solutionHtml !== undefined
          ? { solutionHtml: patch.solutionHtml }
          : {}),
        ...(patch.questionTypeId !== undefined
          ? { questionTypeId: patch.questionTypeId }
          : {}),
        ...(patch.subjectId !== undefined ? { subjectId: patch.subjectId } : {}),
        ...(patch.chapterId !== undefined ? { chapterId: patch.chapterId } : {}),
        ...(patch.topicId !== undefined ? { topicId: patch.topicId } : {}),
        ...(patch.subtopicId !== undefined
          ? { subtopicId: patch.subtopicId }
          : {}),
        ...(patch.difficultyId !== undefined
          ? { difficultyId: patch.difficultyId }
          : {}),
        ...(patch.marks !== undefined ? { marks: patch.marks } : {}),
        overrides: overrides as Prisma.InputJsonValue,
      },
    });

    return this.revalidateRow(updated.id, tenantId);
  }

  /**
   * Re-runs the checks a reviewer's edit could have fixed.
   *
   * Without this a corrected row would keep its BLOCKING severity and commit
   * would stay disabled forever, which is the obvious way for a review UI to
   * become useless.
   */
  private async revalidateRow(rowId: string, tenantId: string) {
    const row = await this.prisma.questionImportRow.findFirst({
      where: { id: rowId, tenantId },
    });
    if (!row) throw new NotFoundException(`Import row not found: ${rowId}`);

    const issues: Issue[] = [];
    const kept = ((row.issues as unknown as Issue[]) ?? []).filter((i) =>
      // Warnings about the document itself survive an edit; blocking problems
      // are recomputed from the row's current state.
      ['DUPLICATE_IN_BANK', 'DUPLICATE_IN_FILE', 'LEGACY_IMAGE_NOT_CONVERTED',
        'IMAGE_UPLOAD_FAILED', 'IMAGE_MISSING', 'BAD_MARKS', 'BAD_VIDEO_URL',
      ].includes(i.code),
    );
    issues.push(...kept);

    if (!row.questionTypeId) {
      issues.push({
        code: 'TYPE_NOT_FOUND',
        severity: 'BLOCKING',
        message: 'Choose a question type for this row.',
      });
    }
    if (!row.bodyHtml || !row.bodyHtml.trim()) {
      issues.push({
        code: 'NO_QUESTION',
        severity: 'BLOCKING',
        message: 'This row has no question text.',
      });
    }

    if (row.questionTypeId) {
      const def = await this.prisma.questionTypeDef.findFirst({
        where: { id: row.questionTypeId, tenantId },
        select: { kernel: true, config: true },
      });
      const kernel = def?.kernel as AnswerKernel | undefined;
      if (
        kernel === AnswerKernel.SINGLE_CHOICE ||
        kernel === AnswerKernel.MULTI_CHOICE
      ) {
        const options = (row.optionsJson as { isCorrect?: boolean }[]) ?? [];
        if (!Array.isArray(options) || options.length < 2) {
          issues.push({
            code: 'TOO_FEW_OPTIONS',
            severity: 'BLOCKING',
            message: 'A choice question needs at least two options.',
          });
        } else if (!options.some((o) => o.isCorrect)) {
          issues.push({
            code: 'NO_CORRECT_OPTION',
            severity: 'BLOCKING',
            message: 'Mark at least one option as correct.',
          });
        } else if (
          kernel === AnswerKernel.SINGLE_CHOICE &&
          options.filter((o) => o.isCorrect).length > 1
        ) {
          issues.push({
            code: 'MULTIPLE_CORRECT_ON_SINGLE',
            severity: 'BLOCKING',
            message: 'This type allows only one correct option.',
          });
        }
      }
    }

    // The taxonomy the reviewer picked must still be a real path.
    const taxonomyIssue = await this.checkTaxonomyChain(row, tenantId);
    if (taxonomyIssue) issues.push(taxonomyIssue);

    return this.prisma.questionImportRow.update({
      where: { id: rowId },
      data: {
        issues: issues as unknown as Prisma.InputJsonValue,
        severity: worstSeverity(issues),
      },
    });
  }

  private async checkTaxonomyChain(
    row: {
      subjectId: string | null;
      chapterId: string | null;
      topicId: string | null;
      subtopicId: string | null;
    },
    tenantId: string,
  ): Promise<Issue | null> {
    const supplied = [
      row.subjectId,
      row.chapterId,
      row.topicId,
      row.subtopicId,
    ];
    if (supplied.every((id) => !id)) return null;

    const nodes = await this.prisma.taxonomy.findMany({
      where: { tenantId, ...notDeleted() },
      select: { id: true, kind: true, name: true, code: true, parentId: true },
    });
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const deepestIdx = [3, 2, 1, 0].find((i) => supplied[i]);
    if (deepestIdx === undefined) return null;

    // Walk up from the deepest chosen node and check the others are on it.
    const chain = new Set<string>();
    let cursor = byId.get(supplied[deepestIdx] as string);
    let guard = 0;
    while (cursor && guard++ < 16) {
      chain.add(cursor.id);
      cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
    }

    for (const [i, id] of supplied.entries()) {
      if (id && !chain.has(id)) {
        return {
          code: 'TAXONOMY_INCOHERENT',
          severity: 'BLOCKING',
          message:
            `The ${LEVEL_ORDER[deepestIdx]} chosen does not sit under the ` +
            `${LEVEL_ORDER[i]} chosen.`,
        };
      }
    }

    return null;
  }

  async dropRow(rowId: string, dropped: boolean, tenantId: string) {
    const row = await this.prisma.questionImportRow.findFirst({
      where: { id: rowId, tenantId },
    });
    if (!row) throw new NotFoundException(`Import row not found: ${rowId}`);
    const job = await this.findJob(row.jobId, tenantId);
    this.assertReviewable(job.status);

    return this.prisma.questionImportRow.update({
      where: { id: rowId },
      data: { dropped },
    });
  }

  /**
   * Applies one taxonomy/type/difficulty choice to many rows at once.
   *
   * This is the case the review screen exists for: one mis-spelled header makes
   * fifty identical BLOCKING rows, and fixing them one at a time is what makes
   * people give up and edit the Word file instead.
   */
  async bulkAssign(
    jobId: string,
    rowIds: string[],
    patch: {
      questionTypeId?: string | null;
      subjectId?: string | null;
      chapterId?: string | null;
      topicId?: string | null;
      subtopicId?: string | null;
      difficultyId?: string | null;
    },
    tenantId: string,
  ): Promise<number> {
    const job = await this.findJob(jobId, tenantId);
    this.assertReviewable(job.status);

    const rows = await this.prisma.questionImportRow.findMany({
      where: { jobId, tenantId, ...(rowIds.length ? { id: { in: rowIds } } : {}) },
      select: { id: true },
    });

    for (const r of rows) {
      await this.updateRow(r.id, patch, tenantId);
    }
    return rows.length;
  }

  private assertReviewable(status: string): void {
    if (status !== IMPORT_STATUS.AWAITING_REVIEW) {
      throw new BadRequestException(
        `This import is ${status.toLowerCase().replace(/_/g, ' ')}; only a job ` +
          `awaiting review can be edited.`,
      );
    }
  }

  /* ─── Commit ────────────────────────────────────────────────────────────── */

  /**
   * Writes the reviewed rows into the bank.
   *
   * Goes through `BankQuestionsService.create` rather than writing `Question`
   * directly, so imported questions get the same validation, the same legacy
   * type mapping and the same `normalizedHash` as hand-authored ones. An
   * importer that wrote its own rows would drift from the editor within a
   * release.
   *
   * Rows are committed one at a time and a failure is recorded against the row
   * rather than rolling the whole job back: by this point a human has reviewed
   * every row, and losing 300 good questions because the 301st is malformed
   * would be the wrong trade.
   */
  async commit(jobId: string, userId: string, tenantId: string) {
    const job = await this.findJob(jobId, tenantId);
    this.assertReviewable(job.status);

    const blocking = await this.prisma.questionImportRow.count({
      where: { jobId, tenantId, dropped: false, severity: 'BLOCKING' },
    });
    if (blocking > 0) {
      throw new BadRequestException(
        `${blocking} row(s) still have problems that must be fixed or dropped ` +
          `before this import can be committed.`,
      );
    }

    await this.prisma.questionImportJob.update({
      where: { id: jobId },
      data: { status: IMPORT_STATUS.COMMITTING },
    });

    const rows = await this.prisma.questionImportRow.findMany({
      where: { jobId, tenantId, dropped: false, createdId: null },
      orderBy: { rowIndex: 'asc' },
    });

    let imported = 0;
    const failures: { rowIndex: number; message: string }[] = [];

    for (const row of rows) {
      try {
        const options = (row.optionsJson as
          | { text: string; isCorrect: boolean }[]
          | null) ?? undefined;

        const created = await this.bankQuestions.create(
          {
            questionText: row.bodyHtml ?? '',
            questionTypeId: row.questionTypeId as string,
            mcqOptions: options,
            answerConfig:
              (row.answerConfig as Record<string, unknown> | null) ?? undefined,
            subjectId: row.subjectId ?? undefined,
            chapterId: row.chapterId ?? undefined,
            topicId: row.topicId ?? undefined,
            subtopicId: row.subtopicId ?? undefined,
            difficultyId: row.difficultyId ?? undefined,
            explanation: row.solutionHtml ?? undefined,
            questionBankId: job.questionBankId ?? undefined,
            marks: row.marks ?? undefined,
            status: QuestionStatus.DRAFT,
          },
          userId,
          tenantId,
        );

        await this.prisma.questionImportRow.update({
          where: { id: row.id },
          data: { createdId: created.id },
        });
        imported++;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        failures.push({ rowIndex: row.rowIndex, message });
        await this.prisma.questionImportRow.update({
          where: { id: row.id },
          data: {
            severity: 'BLOCKING',
            issues: [
              {
                code: 'COMMIT_FAILED',
                severity: 'BLOCKING',
                message,
              },
            ] as unknown as Prisma.InputJsonValue,
          },
        });
      }
    }

    const finished = await this.prisma.questionImportJob.update({
      where: { id: jobId },
      data: {
        // Anything that failed stays reviewable so it can be fixed and
        // re-committed; already-created rows are skipped by `createdId: null`.
        status: failures.length
          ? IMPORT_STATUS.AWAITING_REVIEW
          : IMPORT_STATUS.DONE,
        importedCount: { increment: imported },
        committedAt: failures.length ? null : new Date(),
        failureReason: failures.length
          ? `${failures.length} row(s) could not be imported.`
          : null,
      },
    });

    this.logger.log(
      `Import ${jobId}: committed ${imported} question(s), ${failures.length} failure(s)`,
    );
    return finished;
  }
}
