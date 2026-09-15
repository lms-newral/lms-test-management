import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Job } from 'bullmq';
import { PrismaService } from 'src/prisma/prisma.service';
import { replayAttempt, type ExamEvent } from './attempt-replay.logic';
import { draftResult, historyInsight, scoreAttempt } from './attempt-scoring.logic';
import { ExamAttemptsService } from './exam-attempts.service';
import { ExamPaperService } from './exam-paper.service';
import { AnalyticsQueue } from './analytics.queue';
import { EXAM_FINALIZE_QUEUE, FINALIZE_JOB, SWEEP_JOB } from './exam.constants';

const json = (v: unknown) => (v === null || v === undefined ? Prisma.DbNull : (v as Prisma.InputJsonValue));

/**
 * Scores a finished attempt: replays its stored events, scores against the
 * frozen paper and writes every per-question fact the analytics read (visits,
 * answer history, active and idle time, the unsaved draft). Safe to run again
 * (a late offline tail re-queues it). Also runs the deadline sweep.
 */
@Processor(EXAM_FINALIZE_QUEUE, { concurrency: 8 })
export class ExamFinalizeProcessor extends WorkerHost {
  private readonly logger = new Logger(ExamFinalizeProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly papers: ExamPaperService,
    private readonly attempts: ExamAttemptsService,
    private readonly analytics: AnalyticsQueue,
  ) {
    super();
  }

  async process(job: Job<{ attemptId?: string }>): Promise<void> {
    if (job.name === SWEEP_JOB) {
      const n = await this.attempts.sweepExpired();
      if (n) this.logger.log(`Deadline sweep submitted ${n} attempt(s)`);
      return;
    }
    if (job.name === FINALIZE_JOB && job.data.attemptId) await this.finalize(job.data.attemptId);
  }

  async finalize(attemptId: string) {
    const attempt = await this.prisma.examAttempt.findUnique({
      where: { id: attemptId },
      include: { batches: { orderBy: [{ fromSeq: 'asc' }] } },
    });
    if (!attempt || attempt.status !== 'SUBMITTED') return;

    const paper = await this.papers.frozenPaper(attempt.testId);
    const events = attempt.batches.flatMap((b) => b.events as unknown as ExamEvent[]);
    const startedMs = attempt.startedAt.getTime();
    const allowedMs = attempt.deadline.getTime() - startedMs;
    // Without a SUBMIT from the device, the attempt ended when the server closed it (never after the deadline).
    const closedMs = attempt.submittedAt ? Math.min(attempt.submittedAt.getTime(), attempt.deadline.getTime()) - startedMs : allowedMs;
    const replay = replayAttempt(paper.replay, events, { endMs: Math.max(0, Math.min(closedMs, allowedMs)) });
    const states = Object.fromEntries(
      Object.entries(replay.questions).map(([id, s]) => [id, { status: s.status, answer: s.answer }]),
    );
    const score = scoreAttempt(paper.sheet, states);

    const rows: Prisma.ExamAttemptQuestionCreateManyInput[] = paper.sheet.map((row) => {
      const s = replay.questions[row.questionId];
      const r = score.questions[row.questionId];
      const m = paper.meta[row.questionId];
      const insight = historyInsight(row.key, row.marking, s?.answerHistory ?? []);
      return {
        attemptId,
        questionId: row.questionId,
        subjectName: row.subjectName,
        sectionId: m?.sectionId ?? null,
        sectionName: m?.sectionName ?? null,
        orderIndex: row.orderIndex,
        questionTypeCode: m?.typeCode ?? null,
        chapterId: m?.chapterId ?? null,
        chapterName: m?.chapterName ?? null,
        topicId: m?.topicId ?? null,
        topicName: m?.topicName ?? null,
        subtopicId: m?.subtopicId ?? null,
        subtopicName: m?.subtopicName ?? null,
        difficulty: m?.difficulty ?? null,
        status: s?.status ?? 'NOT_VISITED',
        result: r?.result ?? 'UNANSWERED',
        marks: r?.marks ?? 0,
        maxMarks: r?.maxMarks ?? row.marking.marks,
        negativeMarks: r?.negativeMarks ?? row.marking.negativeMarks,
        evaluated: r?.evaluated ?? false,
        timeMs: s?.timeMs ?? 0,
        hiddenMs: s?.hiddenMs ?? 0,
        activeMs: s?.activeMs ?? 0,
        idleMs: s?.idleMs ?? 0,
        visits: s?.visits.length ?? 0,
        visitTimeline: json(s?.visits ?? []),
        firstSeenMs: s?.firstSeenMs ?? null,
        firstAnsweredMs: s?.firstAnsweredMs ?? null,
        lastAnsweredMs: s?.lastAnsweredMs ?? null,
        answerChanges: s?.answerChanges ?? 0,
        selections: s?.selections ?? 0,
        answer: json(s?.answer),
        answerHistory: json((s?.answerHistory ?? []).map((h, i) => ({ ...h, result: insight.results[i]?.result }))),
        changedCorrectToWrong: insight.changedCorrectToWrong,
        changedWrongToCorrect: insight.changedWrongToCorrect,
        finalDraft: json(s?.finalDraft),
        draftResult: s?.finalDraft ? draftResult(row.key, row.marking, s.finalDraft) : null,
        bookmarked: s?.bookmarked ?? false,
        reported: s?.reported ?? false,
        maxScrollPct: s?.maxScrollPct ?? 0,
      };
    });

    const { questions: _perQuestion, ...totals } = score;
    await this.prisma.$transaction([
      this.prisma.examAttemptQuestion.deleteMany({ where: { attemptId } }),
      this.prisma.examAttemptQuestion.createMany({ data: rows }),
      this.prisma.examAttempt.update({
        where: { id: attemptId },
        data: {
          score: score.total,
          maxMarks: score.maxMarks,
          summary: { ...totals, visitOrder: replay.visitOrder, submitMs: replay.submitMs } as unknown as Prisma.InputJsonValue,
          timeUsedMs: replay.endMs,
          activeMs: replay.activeMs,
          offlineMs: replay.offlineMs,
          outsideFullscreenMs: replay.outsideFullscreenMs,
          instructionsMs: replay.instructionsMs,
          copyAttempts: replay.copyAttempts,
          device: json(replay.device),
          finalizedAt: new Date(),
          needsRecompute: false,
        },
      }),
    ]);
    this.logger.log(`Attempt ${attemptId} scored ${score.total}/${score.maxMarks}`);
    // Debounced: a hall submitting together becomes one recompute, not one per student.
    await this.analytics.schedule(attempt.testId);
  }
}
