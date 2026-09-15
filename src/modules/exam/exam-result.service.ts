import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import type { AuthenticatedUser } from 'src/common/interfaces/auth.interface';
import type { Totals } from './attempt-scoring.logic';
import {
  ANALYTICS_MESSAGES,
  REVIEW_MESSAGES,
  analyticsProblem,
  reviewProblem,
} from './attempt-review.logic';
import { proctoringSummary } from './analytics-proctoring.logic';
import { leaderboard, normaliseNote } from './result-extras.logic';
import { cohortBand, enoughForRank } from './analytics-rank.logic';
import { resultSummary } from './analytics-summary.logic';
import { compareSubjects, type SubjectStats } from './analytics-compare.logic';
import { reviewRow, type QuestionStat } from './analytics-questions.logic';
import {
  behaviourSummary,
  classify,
  type ClassTiming,
} from './analytics-behaviour.logic';
import { improvementScope } from './analytics-improvement.logic';
import {
  timeByOutcome,
  timeBySubject,
  timeJourney,
  type VisitSpan,
} from './analytics-time.logic';
import {
  difficultyBreakup,
  type ClassDifficulty,
} from './analytics-difficulty.logic';
import { solvingFlow } from './analytics-flow.logic';
import { COHORT_STATS_VERSION } from './analytics-compute.service';
import { ExamAttemptsService } from './exam-attempts.service';

interface StoredSubjectStats {
  all?: SubjectStats;
  top10?: SubjectStats;
  top25?: SubjectStats;
}

/**
 * A student's result, composed when they open it from the test's aggregates and
 * their own per-question rows.
 *
 * Nothing per-student is stored: at 100,000 attempts a stored result document
 * would mean rewriting 100,000 blobs every time a later batch shifts the ranks,
 * against a few thousand aggregate rows this way.
 */
@Injectable()
export class ExamResultService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly attempts: ExamAttemptsService,
  ) {}

  /** The student's own result. Gated on the test's result time. */
  async result(nodeId: string, user: AuthenticatedUser) {
    const node = await this.attempts.studentNode(nodeId, user);
    const attempt = await this.prisma.examAttempt.findUnique({
      where: { testId_userId: { testId: node.testId!, userId: user.userId } },
    });

    const problem = analyticsProblem(
      attempt && {
        status: attempt.status,
        finalizedAt: attempt.finalizedAt,
        resultAt: node.resultAt,
      },
      new Date(),
    );
    if (problem || !attempt)
      throw new BadRequestException(
        ANALYTICS_MESSAGES[problem ?? 'NOT_ATTEMPTED'],
      );

    return this.compose(attempt, { proctoring: false });
  }

  /**
   * The same analysis for an admin, plus the integrity panel, and without
   * waiting for the result time — checking a paper before results go out is the
   * entire point of having a result time.
   */
  async adminResult(attemptId: string, user: AuthenticatedUser) {
    const attempt = await this.prisma.examAttempt.findFirst({
      where: { id: attemptId, tenantId: user.tenantId },
    });
    const problem = reviewProblem(
      attempt && { status: attempt.status, finalizedAt: attempt.finalizedAt },
    );
    if (problem || !attempt)
      throw new BadRequestException(
        REVIEW_MESSAGES[problem ?? 'NOT_ATTEMPTED'],
      );

    return this.compose(attempt, { proctoring: true });
  }

  /**
   * Everyone who attempted this test, best first — the table an admin opens
   * after a test closes. Carries just enough to spot who needs a closer look.
   */
  async testAttempts(
    nodeId: string,
    user: AuthenticatedUser,
    options: { search?: string | null; take?: number; skip?: number } = {},
  ) {
    const node = await this.prisma.testSeriesNode.findFirst({
      where: { id: nodeId, kind: 'TEST', series: { tenantId: user.tenantId } },
      include: { test: { select: { id: true, name: true } } },
    });
    if (!node?.testId)
      throw new NotFoundException('This test is not available.');

    const search = options.search?.trim();
    const where = {
      testId: node.testId,
      tenantId: user.tenantId,
      ...(search
        ? { userName: { contains: search, mode: 'insensitive' as const } }
        : {}),
    };
    const [rows, total, enrolled] = await Promise.all([
      this.prisma.examAttempt.findMany({
        where,
        orderBy: [{ score: 'desc' }, { submittedAt: 'asc' }],
        take: Math.min(options.take ?? 50, 200),
        skip: options.skip ?? 0,
      }),
      this.prisma.examAttempt.count({ where }),
      this.prisma.testSeriesEnrollment.findMany({
        where: { seriesId: node.seriesId },
        select: { userId: true, userEmail: true },
      }),
    ]);
    const emailOf = new Map(enrolled.map((e) => [e.userId, e.userEmail]));

    return {
      testName: node.test?.name ?? '',
      nodeId,
      total,
      attempts: rows.map((a) => {
        const flags = proctoringSummary(a).flags;
        return {
          attemptId: a.id,
          userId: a.userId,
          name: a.userName,
          email: emailOf.get(a.userId) ?? null,
          status: a.status,
          scored: a.finalizedAt !== null,
          score: a.score,
          maxMarks: a.maxMarks,
          rank: a.rank,
          rankOutOf: a.rankOutOf,
          percentile: a.percentile,
          submittedAt: a.submittedAt,
          timeUsedMs: a.timeUsedMs,
          violations: a.violations,
          refreshes: a.refreshes,
          concerns: flags.filter((f) => f.level !== 'INFO').length,
          topFlag: flags[0] ?? null,
        };
      }),
    };
  }

  /** One student's attempts across a whole series, in schedule order. */
  async studentSeriesAttempts(
    seriesId: string,
    userId: string,
    user: AuthenticatedUser,
  ) {
    const nodes = await this.prisma.testSeriesNode.findMany({
      where: {
        seriesId,
        kind: 'TEST',
        series: { tenantId: user.tenantId },
        testId: { not: null },
      },
      include: { test: { select: { id: true, name: true } } },
      orderBy: [{ orderIndex: 'asc' }],
    });
    const attempts = await this.prisma.examAttempt.findMany({
      where: {
        userId,
        tenantId: user.tenantId,
        testId: { in: nodes.map((n) => n.testId!) },
      },
    });
    const byTest = new Map(attempts.map((a) => [a.testId, a]));

    return {
      userId,
      name: attempts[0]?.userName ?? null,
      tests: nodes.map((node) => {
        const attempt = byTest.get(node.testId!);
        return {
          nodeId: node.id,
          testName: node.test?.name ?? '',
          availableFrom: node.availableFrom,
          resultAt: node.resultAt,
          attemptId: attempt?.id ?? null,
          status: attempt?.status ?? null,
          scored: attempt?.finalizedAt !== null && attempt !== undefined,
          score: attempt?.score ?? null,
          maxMarks: attempt?.maxMarks ?? null,
          rank: attempt?.rank ?? null,
          rankOutOf: attempt?.rankOutOf ?? null,
          percentile: attempt?.percentile ?? null,
          submittedAt: attempt?.submittedAt ?? null,
          concerns: attempt
            ? proctoringSummary(attempt).flags.filter((f) => f.level !== 'INFO')
                .length
            : 0,
        };
      }),
    };
  }

  /** Everything both views share: one attempt, set against its cohort. */
  private async compose(
    attempt: NonNullable<
      Awaited<ReturnType<PrismaService['examAttempt']['findFirst']>>
    >,
    options: { proctoring: boolean },
  ) {
    const [analytics, rows, test] = await Promise.all([
      this.prisma.testAnalytics.findUnique({
        where: { testId: attempt.testId },
      }),
      this.prisma.examAttemptQuestion.findMany({
        where: { attemptId: attempt.id },
        orderBy: [{ orderIndex: 'asc' }],
      }),
      this.prisma.test.findUnique({
        where: { id: attempt.testId },
        select: {
          name: true,
          format: { select: { bands: { orderBy: [{ minScore: 'asc' }] } } },
        },
      }),
    ]);
    if (!analytics) throw new BadRequestException(ANALYTICS_MESSAGES.SCORING);

    const stats = await this.prisma.testQuestionStat.findMany({
      where: { testId: attempt.testId },
    });
    const statOf = new Map(stats.map((s) => [s.questionId, s]));
    // With too few students, "the top 10%" is just this student; compare nothing until it means something.
    const compareReady = enoughForRank(analytics.attemptCount);
    const cohort = (
      compareReady ? (analytics.subjectStats ?? {}) : {}
    ) as StoredSubjectStats;
    const pct = (part: number, whole: number) =>
      whole > 0 ? Math.round((part / whole) * 10000) / 100 : null;

    // The student's own subject totals come from the score summary written at finalize time.
    const summary = (attempt.summary ?? {}) as unknown as Totals & {
      subjects?: Record<string, Totals>;
    };
    const mine: SubjectStats = {};
    for (const [subject, totals] of Object.entries(summary.subjects ?? {})) {
      const timeMs = rows
        .filter((r) => r.subjectName === subject)
        .reduce((sum, r) => sum + r.timeMs, 0);
      mine[subject] = {
        score: totals.total,
        timeMs,
        accuracy: totals.accuracy,
      };
    }

    // One shape every analytics module reads, built once from the stored rows.
    const facts = rows.map((r) => ({
      questionId: r.questionId,
      subjectName: r.subjectName,
      difficulty: r.difficulty,
      orderIndex: r.orderIndex,
      result: r.result,
      marks: r.marks,
      maxMarks: r.maxMarks ?? 0,
      timeMs: r.timeMs,
      visits: r.visits,
      lastAnsweredMs: r.lastAnsweredMs,
      visitTimeline: (r.visitTimeline ?? []) as unknown as VisitSpan[],
    }));
    const timings = new Map<string, ClassTiming | null>(
      stats.map((s) => [
        s.questionId,
        {
          attempts: s.attempts,
          avgTimeMs: s.avgTimeMs,
          avgTimeCorrectMs: s.avgTimeCorrectMs,
        },
      ]),
    );
    // The paper ended when the attempt did; the journey is measured inside that.
    const endMs = attempt.timeUsedMs ?? 0;

    const ranked = enoughForRank(attempt.rankOutOf ?? 0);
    const board = compareReady
      ? await this.prisma.examAttempt.findMany({
          where: {
            testId: attempt.testId,
            finalizedAt: { not: null },
            score: { not: null },
            rank: { not: null },
          },
          orderBy: [{ rank: 'asc' }, { submittedAt: 'asc' }],
          take: 10,
          select: { id: true, rank: true, score: true, userName: true },
        })
      : [];
    const onBoard = board.some((b) => b.id === attempt.id);
    return {
      attemptId: attempt.id,
      student: options.proctoring
        ? {
            userId: attempt.userId,
            name: attempt.userName,
            cohort: attempt.cohort,
          }
        : null,
      submittedAt: attempt.submittedAt,
      proctoring: options.proctoring ? proctoringSummary(attempt) : null,
      testName: test?.name ?? '',
      computedAt: analytics.computedAt,
      compareReady,
      cohortStats:
        compareReady &&
        (analytics.subjectStats as { version?: number } | null)?.version ===
          COHORT_STATS_VERSION
          ? analytics.subjectStats
          : null,
      leaderboard: compareReady
        ? leaderboard(
            onBoard
              ? board
              : [
                  ...board,
                  {
                    id: attempt.id,
                    rank: attempt.rank,
                    score: attempt.score,
                    userName: attempt.userName,
                  },
                ],
            attempt.id,
            10,
          )
        : null,
      note: attempt.studentNote ?? null,
      noteUpdatedAt: attempt.noteUpdatedAt ?? null,
      cohortSize: attempt.rankOutOf ?? analytics.attemptCount,
      summary: resultSummary(
        {
          totals: summary,
          timeUsedMs: attempt.timeUsedMs ?? 0,
          rank: ranked ? attempt.rank : null,
          rankOutOf: attempt.rankOutOf ?? analytics.attemptCount,
          percentile: ranked ? attempt.percentile : null,
        },
        test?.format.bands ?? [],
      ),
      band:
        ranked && attempt.rank
          ? cohortBand(attempt.rank, attempt.rankOutOf ?? 0)
          : null,
      cohort: {
        meanScore: analytics.meanScore,
        medianScore: analytics.medianScore,
        topScore: analytics.topScore,
        top10Cutoff: analytics.top10Cutoff,
        top25Cutoff: analytics.top25Cutoff,
      },
      subjects: compareSubjects(
        mine,
        cohort.top10 ?? {},
        cohort.top25 ?? {},
        cohort.all ?? {},
      ),
      difficulty: difficultyBreakup(
        facts,
        analytics.difficultyStats as unknown as Record<string, ClassDifficulty>,
      ),
      behaviour: behaviourSummary(facts, timings),
      improvement: improvementScope(facts),
      time: {
        bySubject: timeBySubject(facts),
        byOutcome: timeByOutcome(facts),
        journey: timeJourney(facts, endMs),
      },
      flow: solvingFlow(facts, endMs),
      questions: rows.map((row, i) => {
        const stat = statOf.get(row.questionId);
        const asStat: QuestionStat | null =
          compareReady && stat
            ? {
                attempts: stat.attempts,
                correct: stat.correct,
                avgTimeMs: stat.avgTimeMs,
                topperAvgTimeMs: stat.topperAvgTimeMs,
                topperAccuracy:
                  stat.topperAttempts && stat.topperAttempts > 0
                    ? Math.round(
                        ((stat.topperCorrect ?? 0) / stat.topperAttempts) *
                          10000,
                      ) / 100
                    : null,
              }
            : null;
        return {
          number: row.orderIndex + 1,
          typeCode: row.questionTypeCode,
          sectionName: row.sectionName,
          maxMarks: row.maxMarks ?? 0,
          // How everyone else did on this question — only once there is a real cohort.
          classCorrectPct:
            compareReady && stat ? pct(stat.correct, stat.attempts) : null,
          classIncorrectPct:
            compareReady && stat ? pct(stat.incorrect, stat.attempts) : null,
          classSkippedPct:
            compareReady && stat ? pct(stat.unanswered, stat.attempts) : null,
          classAvgTimeMs: compareReady && stat ? stat.avgTimeMs : null,
          // How this question was handled, against the class: Solid, Rushed, Stuck…
          behaviour: classify(facts[i], timings.get(row.questionId) ?? null),
          ...reviewRow(
            {
              questionId: row.questionId,
              subjectName: row.subjectName,
              chapterName: row.chapterName,
              topicName: row.topicName,
              difficulty: row.difficulty,
              status: row.status,
              result: row.result,
              marks: row.marks,
              timeMs: row.timeMs,
              visits: row.visits,
              answerChanges: row.answerChanges,
            },
            asStat,
          ),
        };
      }),
    };
  }

  /** "Points to be Noted": the student's own note on their submitted attempt. */
  async saveNote(nodeId: string, text: string, user: AuthenticatedUser) {
    const node = await this.attempts.studentNode(nodeId, user);
    const attempt = await this.prisma.examAttempt.findUnique({
      where: { testId_userId: { testId: node.testId!, userId: user.userId } },
    });
    if (!attempt || attempt.status !== 'SUBMITTED') {
      throw new BadRequestException(
        'Submit the test before writing notes on it.',
      );
    }
    const normal = normaliseNote(text);
    if ('problem' in normal) throw new BadRequestException(normal.problem);
    const saved = await this.prisma.examAttempt.update({
      where: { id: attempt.id },
      data: { studentNote: normal.note, noteUpdatedAt: new Date() },
      select: { studentNote: true, noteUpdatedAt: true },
    });
    return { note: saved.studentNote, noteUpdatedAt: saved.noteUpdatedAt };
  }
}
