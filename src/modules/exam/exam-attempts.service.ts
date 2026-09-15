import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ExamAttempt,
  ExamAttemptStatus,
  Prisma,
  TestStatus,
} from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { notDeleted } from 'src/prisma/soft-delete';
import type { AuthenticatedUser } from 'src/common/interfaces/auth.interface';
import { seriesReadable, seriesVisible } from '../tests/test-series.logic';
import { canStart, deadlineFor } from './attempt-clock.logic';
import {
  MAX_REFRESHES,
  MAX_WARNINGS,
  recordRefresh,
  refreshNotice,
} from './attempt-proctor.logic';
import { signAttemptToken } from './attempt-ingest.logic';
import { cohortSnapshot } from './attempt-cohort.logic';
import {
  REVIEW_MESSAGES,
  answerLabel,
  correctLabel,
  reviewPaletteStatus,
  reviewProblem,
} from './attempt-review.logic';
import type { QuestionResult, ScoredAnswer } from './attempt-scoring.logic';
import type { Request } from 'express';
import { SessionService } from '../auth/session.service';
import { ExamPaperService } from './exam-paper.service';
import { ExamFinalizeQueue } from './exam-finalize.queue';
import { SUBMIT_GRACE_MS } from './exam.constants';
import type { ExamSessionEntity } from './exam.entities';

type Attempt = ExamAttempt;

/**
 * Starting, re-entering and closing attempts. Every re-entry to a running
 * attempt (reload, reopening the exam) counts as a refresh: 5 are allowed with
 * a notice, the 6th submits. The server decides deadlines and counts.
 */
@Injectable()
export class ExamAttemptsService {
  private readonly tokenSecret: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly papers: ExamPaperService,
    private readonly finalizeQueue: ExamFinalizeQueue,
    private readonly sessions: SessionService,
    config: ConfigService,
  ) {
    const secret = config.get<string>('EXAM_TOKEN_SECRET');
    if (!secret) throw new Error('EXAM_TOKEN_SECRET is not configured');
    this.tokenSecret = secret;
  }

  /** The student's attempt for a test in a series, if any (for the Start / Resume button). */
  async myAttempt(nodeId: string, user: AuthenticatedUser) {
    const node = await this.readNode(nodeId, user);
    const attempt = await this.prisma.examAttempt.findUnique({
      where: { testId_userId: { testId: node.testId!, userId: user.userId } },
    });
    return attempt
      ? {
          attemptId: attempt.id,
          status: attempt.status,
          startedAt: attempt.startedAt,
          deadline: attempt.deadline,
          submittedAt: attempt.submittedAt ?? undefined,
          submitReason: attempt.submitReason ?? undefined,
        }
      : null;
  }

  /** PROCEED on the instructions page, or reopening the exam: creates the attempt or re-enters it. */
  async enter(
    nodeId: string,
    user: AuthenticatedUser,
    req?: Request,
  ): Promise<ExamSessionEntity> {
    const node = await this.loadNode(nodeId, user);
    const now = new Date();
    let attempt = await this.prisma.examAttempt.findUnique({
      where: { testId_userId: { testId: node.testId!, userId: user.userId } },
    });
    let action: ExamSessionEntity['action'] = { type: 'NONE' };

    if (!attempt) {
      const open = canStart(
        { availableFrom: node.availableFrom!, availableTo: node.availableTo! },
        now,
      );
      if (!open.ok) {
        throw new BadRequestException(
          open.reason === 'NOT_OPEN'
            ? 'This test has not opened yet.'
            : 'This test is closed.',
        );
      }
      const duration =
        node.test!.durationMinutes ?? node.test!.format.durationMinutes;
      // Frozen for cohort comparisons: the series' class and target year, the student's
      // city, state and courses, and the device.
      const source = req
        ? await this.sessions.studentCohortSource(req)
        : { city: null, state: null, courseIds: [] };
      const userAgent = req?.headers['user-agent'];
      const cohort = cohortSnapshot(
        {
          classLevel: node.series.classLevel,
          targetYear: node.series.targetYear,
          city: source.city,
          state: source.state,
        },
        source.courseIds,
        typeof userAgent === 'string' ? userAgent : null,
      );
      try {
        attempt = await this.prisma.examAttempt.create({
          data: {
            tenantId: user.tenantId,
            testId: node.testId!,
            seriesId: node.seriesId,
            seriesNodeId: node.id,
            userId: user.userId,
            userName:
              [user.firstName, user.lastName].filter(Boolean).join(' ') ||
              user.email,
            startedAt: now,
            deadline: deadlineFor(now, duration, node.availableTo!),
            resultAt: node.resultAt,
            cohort: cohort as unknown as Prisma.InputJsonValue,
          },
        });
      } catch (e) {
        // A double click created it a moment ago: use that one, not a refresh.
        if (!(
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2002'
        ))
          throw e;
        attempt = await this.prisma.examAttempt.findUniqueOrThrow({
          where: {
            testId_userId: { testId: node.testId!, userId: user.userId },
          },
        });
      }
    } else if (attempt.status === ExamAttemptStatus.IN_PROGRESS) {
      if (now.getTime() > attempt.deadline.getTime() + SUBMIT_GRACE_MS) {
        attempt =
          (await this.submitByServer(attempt.id, 'AUTO_TIME')) ?? attempt;
      } else {
        const refresh = recordRefresh({
          violations: attempt.violations,
          refreshes: attempt.refreshes,
          lastViolationT: attempt.lastViolationT,
          submitted: false,
        });
        attempt = await this.prisma.examAttempt.update({
          where: { id: attempt.id },
          data: { refreshes: refresh.state.refreshes },
        });
        if (refresh.action.type === 'AUTO_SUBMIT') {
          attempt =
            (await this.submitByServer(attempt.id, 'REFRESHES')) ?? attempt;
          action = {
            type: 'AUTO_SUBMIT',
            reason: 'REFRESHES',
            message:
              'You refreshed the test more than 5 times, so it has been submitted.',
          };
        } else if (refresh.action.type === 'REFRESH_NOTICE') {
          action = {
            type: 'REFRESH_NOTICE',
            count: refresh.action.count,
            max: refresh.action.max,
            message: refreshNotice(refresh.action.count),
          };
        }
      }
    }

    return this.session(attempt, node.test!.name, user, now, action);
  }

  /** "View solution": the paper with the key, solutions and the student's answers. Only after the result time. */
  async review(nodeId: string, user: AuthenticatedUser) {
    const node = await this.readNode(nodeId, user);
    const attempt = await this.prisma.examAttempt.findUnique({
      where: { testId_userId: { testId: node.testId!, userId: user.userId } },
    });
    // Solutions need only the student's own finished, scored attempt. Analytics wait for resultAt.
    const problem = reviewProblem(
      attempt && { status: attempt.status, finalizedAt: attempt.finalizedAt },
    );
    if (problem || !attempt)
      throw new BadRequestException(
        REVIEW_MESSAGES[problem ?? 'NOT_ATTEMPTED'],
      );

    const [{ student, sheet }, usages, rows] = await Promise.all([
      this.papers.frozenPaper(attempt.testId),
      this.prisma.questionUsage.findMany({
        where: { usedInType: 'TEST', usedInId: attempt.testId },
        select: { questionId: true, snapshot: true },
      }),
      this.prisma.examAttemptQuestion.findMany({
        where: { attemptId: attempt.id },
      }),
    ]);
    type Solutions = {
      explanation?: string | null;
      solutions?: {
        kind: string;
        contentHtml: string | null;
        videoUrl: string | null;
      }[];
    };
    const snapshots = new Map(
      usages.map((u) => [u.questionId, (u.snapshot ?? {}) as Solutions]),
    );
    const keys = new Map(sheet.map((r) => [r.questionId, r.key]));
    const answers = new Map(rows.map((r) => [r.questionId, r]));
    const subjects = new Map(
      student.sections.map((s) => [s.id, s.subjectName]),
    );

    return {
      testName: student.testName,
      candidateName: attempt.userName ?? user.email,
      score: Number(attempt.score ?? 0),
      maxMarks: Number(attempt.maxMarks ?? 0),
      questions: student.questions.map((q) => {
        const key = keys.get(q.id);
        const row = answers.get(q.id);
        const answer = (row?.answer ?? null) as ScoredAnswer;
        const result = (row?.result ?? 'UNANSWERED') as QuestionResult;
        const snap = snapshots.get(q.id) ?? {};
        return {
          id: q.id,
          sectionId: q.sectionId,
          subjectName: subjects.get(q.sectionId) ?? '',
          kernel: q.kernel,
          typeCode: q.typeCode,
          text: q.text,
          options: q.options.map((o, i) => ({
            text: o.text,
            isCorrect: !!key?.options?.[i]?.isCorrect,
          })),
          marks: q.marks,
          negativeMarks: q.negativeMarks,
          result,
          status: reviewPaletteStatus(result),
          awarded: Number(row?.marks ?? 0),
          timeMs: Number(row?.timeMs ?? 0),
          chosen: answer?.choice ?? [],
          yourAnswer: answerLabel(q.kernel, answer, q.optionCount),
          correctAnswer: key?.dropped
            ? 'Dropped (bonus)'
            : correctLabel(
                q.kernel,
                key?.options ?? [],
                key?.answerConfig ?? null,
              ),
          explanation: snap.explanation ?? null,
          solutions: (snap.solutions ?? []).map(
            ({ kind, contentHtml, videoUrl }) => ({
              kind,
              contentHtml,
              videoUrl,
            }),
          ),
        };
      }),
    };
  }

  /** Events already stored for this attempt, for restoring on a new device. */
  async committedEvents(
    attemptId: string,
    fromSeq: number,
    user: AuthenticatedUser,
  ) {
    const attempt = await this.prisma.examAttempt.findFirst({
      where: { id: attemptId, userId: user.userId, tenantId: user.tenantId },
    });
    if (!attempt) throw new NotFoundException('Attempt not found');
    const batches = await this.prisma.examEventBatch.findMany({
      where: { attemptId, toSeq: { gte: fromSeq } },
      orderBy: [{ fromSeq: 'asc' }],
    });
    return batches.flatMap((b) =>
      (b.events as { seq: number }[]).filter((e) => e.seq >= fromSeq),
    );
  }

  /** Closes an attempt the device did not close (deadline passed, or a limit was hit). Idempotent. */
  async submitByServer(
    attemptId: string,
    reason: 'AUTO_TIME' | 'VIOLATIONS' | 'REFRESHES',
  ): Promise<Attempt | null> {
    const closed = await this.prisma.examAttempt.updateMany({
      where: { id: attemptId, status: ExamAttemptStatus.IN_PROGRESS },
      data: {
        status: ExamAttemptStatus.SUBMITTED,
        submittedAt: new Date(),
        submittedBy: 'SERVER',
        submitReason: reason,
      },
    });
    if (closed.count > 0) await this.finalizeQueue.finalize([attemptId]);
    return this.prisma.examAttempt.findUnique({ where: { id: attemptId } });
  }

  /** Deadline sweep: attempts whose device never submitted. */
  async sweepExpired(limit = 1000) {
    const expired = await this.prisma.examAttempt.findMany({
      where: {
        status: ExamAttemptStatus.IN_PROGRESS,
        deadline: { lt: new Date(Date.now() - SUBMIT_GRACE_MS) },
      },
      select: { id: true },
      take: limit,
    });
    for (const a of expired) await this.submitByServer(a.id, 'AUTO_TIME');
    return expired.length;
  }

  // ─── helpers ───────────────────────────────────────────────────────────────

  /** A test the student may look back at: results, solutions, their note. */
  async studentNode(nodeId: string, user: AuthenticatedUser) {
    return this.readNode(nodeId, user);
  }

  /**
   * For looking back at a test already taken. Unlike entering, this does not
   * need the series to still be on sale or inside its dates: an enrolled
   * student keeps their results after the series ends, and anyone with an
   * attempt can always reach it (even if an admin later removed them).
   */
  private async readNode(nodeId: string, user: AuthenticatedUser) {
    const node = await this.prisma.testSeriesNode.findFirst({
      where: {
        id: nodeId,
        kind: 'TEST',
        series: { tenantId: user.tenantId, ...notDeleted() },
      },
      include: {
        series: {
          include: {
            enrollments: {
              where: { userId: user.userId },
              select: { id: true },
            },
          },
        },
        test: { include: { format: { select: { durationMinutes: true } } } },
      },
    });
    if (!node?.testId || !node.test || node.test.deletedAt)
      throw new NotFoundException('This test is not available.');
    const enrolled = node.series.enrollments.length > 0;
    const attempted = await this.prisma.examAttempt.findUnique({
      where: { testId_userId: { testId: node.testId, userId: user.userId } },
      select: { id: true },
    });
    if (!attempted && !seriesReadable(node.series, new Date(), enrolled)) {
      throw new NotFoundException('This test is not available.');
    }
    if (!attempted && !enrolled)
      throw new ForbiddenException('Join the test series to see this test.');
    return node;
  }

  private async loadNode(nodeId: string, user: AuthenticatedUser) {
    const node = await this.prisma.testSeriesNode.findFirst({
      where: {
        id: nodeId,
        kind: 'TEST',
        series: { tenantId: user.tenantId, ...notDeleted() },
      },
      include: {
        series: {
          include: {
            enrollments: {
              where: { userId: user.userId },
              select: { id: true },
            },
          },
        },
        test: { include: { format: { select: { durationMinutes: true } } } },
      },
    });
    if (
      !node ||
      !node.test ||
      node.test.deletedAt ||
      node.test.status !== TestStatus.PUBLISHED
    ) {
      throw new NotFoundException('This test is not available.');
    }
    if (
      !seriesVisible(node.series, new Date()) ||
      !node.availableFrom ||
      !node.availableTo
    ) {
      throw new NotFoundException('This test is not available.');
    }
    if (node.series.enrollments.length === 0)
      throw new ForbiddenException('Join the test series to take this test.');
    return node;
  }

  private async session(
    attempt: Attempt,
    testName: string,
    user: AuthenticatedUser,
    now: Date,
    action: ExamSessionEntity['action'],
  ): Promise<ExamSessionEntity> {
    const inProgress = attempt.status === ExamAttemptStatus.IN_PROGRESS;
    // Long enough for an offline device to sync its sealed tail until results.
    const tokenUntil =
      Math.max(attempt.deadline.getTime(), attempt.resultAt?.getTime() ?? 0) +
      24 * 3600_000;
    const paper = inProgress
      ? await this.papers.paperAccess(
          attempt.testId,
          Math.ceil((attempt.deadline.getTime() - now.getTime()) / 1000) + 3600,
        )
      : null;
    return {
      attemptId: attempt.id,
      status: attempt.status,
      token: signAttemptToken(
        {
          attemptId: attempt.id,
          userId: user.userId,
          tenantId: user.tenantId,
          exp: tokenUntil,
        },
        this.tokenSecret,
      ),
      startedAt: attempt.startedAt,
      deadline: attempt.deadline,
      serverTime: now,
      testName,
      candidateName: attempt.userName ?? user.email,
      paperUrl: paper?.url,
      paperSecret: paper?.secret,
      violations: attempt.violations,
      refreshes: attempt.refreshes,
      maxWarnings: MAX_WARNINGS,
      maxRefreshes: MAX_REFRESHES,
      lastSeq: attempt.lastSeq,
      chainHead: attempt.chainHead,
      submitReason: attempt.submitReason ?? undefined,
      action,
    };
  }
}
