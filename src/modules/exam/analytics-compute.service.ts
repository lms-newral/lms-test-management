import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { MIN_COHORT } from './analytics-rank.logic';
import { MIN_CLASS_ATTEMPTS } from './analytics-behaviour.logic';

type CohortGroup = 'all' | 'top10' | 'top25';
type Averages = Record<string, number>;
interface CohortSubject {
  score: number;
  maxMarks: number;
  timeMs: number;
  accuracy: number;
  correct: number;
  incorrect: number;
  skipped: number;
  notSeen: number;
  attempted: number;
  timeCorrectMs: number;
  timeWrongMs: number;
  behaviour: Averages;
}
/**
 * Bump when the shape of TestAnalytics.subjectStats changes. The sweep recomputes
 * every test stored under an older version, so no test is stuck on an old shape.
 */
export const COHORT_STATS_VERSION = 2;

/** Stored in TestAnalytics.subjectStats. `all/top10/top25` keep the older score/timeMs/accuracy keys. */
export interface CohortStatsJson {
  version: number;
  all: Record<string, CohortSubject>;
  top10: Record<string, CohortSubject>;
  top25: Record<string, CohortSubject>;
  difficulty: Record<CohortGroup, Record<string, Record<string, Averages>>>;
}

const num = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v);
const round2 = (v: unknown): number | null => {
  const n = num(v);
  return n === null ? null : Math.round((n + Number.EPSILON) * 100) / 100;
};

/**
 * Turns every finalised attempt of a test into the aggregates the result screens
 * read: cohort scores, each attempt's rank and percentile, per-question class
 * statistics, and subject averages for everyone, the top 10% and the top 25%.
 *
 * All of it runs as SQL inside Postgres. At 100,000 attempts and nine million
 * per-question rows, pulling this into Node would not finish; as aggregates it
 * is a handful of scans.
 *
 * The cohort is every attempt of the test, in any series, so a rank shifts as
 * later batches take the same paper — which is why each attempt stores the
 * cohort size and the time it was stamped.
 */
@Injectable()
export class AnalyticsComputeService {
  private readonly logger = new Logger(AnalyticsComputeService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** The scored cohort: finished, scored, and not still being written. */
  private static readonly COHORT = `"testId" = $1 AND "finalizedAt" IS NOT NULL AND score IS NOT NULL`;

  async compute(
    testId: string,
  ): Promise<{ attemptCount: number; questions: number }> {
    const started = Date.now();
    const test = await this.prisma.test.findUnique({
      where: { id: testId },
      select: { tenantId: true },
    });
    if (!test) return { attemptCount: 0, questions: 0 };

    const [head] = await this.prisma.$queryRawUnsafe<
      {
        n: bigint;
        mean: number | null;
        median: number | null;
        top: number | null;
      }[]
    >(
      `SELECT COUNT(*)::bigint AS n, AVG(score) AS mean,
              PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY score) AS median, MAX(score) AS top
         FROM "ExamAttempt" WHERE ${AnalyticsComputeService.COHORT}`,
      testId,
    );
    const attemptCount = Number(head?.n ?? 0);

    // Cut-offs by rank, matching analytics-rank.logic: the lowest score still inside the fraction.
    const [cuts] = await this.prisma.$queryRawUnsafe<
      { cut10: number | null; cut25: number | null }[]
    >(
      `WITH ranked AS (
         SELECT score, RANK() OVER (ORDER BY score DESC) AS rnk, COUNT(*) OVER () AS total
           FROM "ExamAttempt" WHERE ${AnalyticsComputeService.COHORT})
       SELECT MIN(score) FILTER (WHERE rnk <= GREATEST(1, CEIL(total * 0.10))) AS cut10,
              MIN(score) FILTER (WHERE rnk <= GREATEST(1, CEIL(total * 0.25))) AS cut25
         FROM ranked`,
      testId,
    );

    await this.stampRanks(testId, attemptCount);
    const questions = await this.questionStats(
      testId,
      test.tenantId,
      num(cuts?.cut10),
    );
    const subjectStats = await this.subjectStats(testId);
    const difficultyStats = await this.difficultyStats(testId);

    await this.prisma.testAnalytics.upsert({
      where: { testId },
      create: {
        testId,
        tenantId: test.tenantId,
        attemptCount,
        meanScore: round2(head?.mean),
        medianScore: round2(head?.median),
        topScore: num(head?.top),
        top10Cutoff: num(cuts?.cut10),
        top25Cutoff: num(cuts?.cut25),
        subjectStats: subjectStats as unknown as Prisma.InputJsonValue,
        difficultyStats: difficultyStats,
      },
      update: {
        attemptCount,
        computedAt: new Date(),
        meanScore: round2(head?.mean),
        medianScore: round2(head?.median),
        topScore: num(head?.top),
        top10Cutoff: num(cuts?.cut10),
        top25Cutoff: num(cuts?.cut25),
        subjectStats: subjectStats as unknown as Prisma.InputJsonValue,
        difficultyStats: difficultyStats,
      },
    });

    this.logger.log(
      `Analytics for test ${testId}: ${attemptCount} attempt(s), ${questions} question(s) in ${Date.now() - started}ms`,
    );
    return { attemptCount, questions };
  }

  /**
   * Rank and percentile onto every attempt in one statement. Percentile is NTA's:
   * the share of candidates at or below you, so the topper is 100.
   */
  private async stampRanks(testId: string, attemptCount: number) {
    if (attemptCount < MIN_COHORT) {
      // Too few to rank, but the cohort size and the time are still true.
      await this.prisma.$executeRawUnsafe(
        `UPDATE "ExamAttempt" SET "rank" = NULL, "percentile" = NULL, "rankOutOf" = $2, "analyticsAt" = NOW()
           WHERE ${AnalyticsComputeService.COHORT}`,
        testId,
        attemptCount,
      );
      return;
    }
    await this.prisma.$executeRawUnsafe(
      `WITH ranked AS (
         SELECT id,
                RANK() OVER (ORDER BY score DESC) AS rnk,
                COUNT(*) OVER () AS total,
                ROUND((COUNT(*) OVER (ORDER BY score ASC RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW))::numeric
                        * 100 / COUNT(*) OVER (), 2) AS pct
           FROM "ExamAttempt" WHERE ${AnalyticsComputeService.COHORT})
       UPDATE "ExamAttempt" a
          SET "rank" = r.rnk, "rankOutOf" = r.total, "percentile" = r.pct, "analyticsAt" = NOW()
         FROM ranked r WHERE a.id = r.id`,
      testId,
    );
  }

  /** Class accuracy and timings per question, including how the top 10% did on it. */
  private async questionStats(
    testId: string,
    tenantId: string,
    top10Cutoff: number | null,
  ): Promise<number> {
    return this.prisma.$executeRawUnsafe(
      `INSERT INTO "TestQuestionStat" (
         id, "tenantId", "testId", "questionId", attempts, correct, incorrect, unanswered,
         "avgTimeMs", "avgTimeCorrectMs", "topperAttempts", "topperCorrect", "topperAvgTimeMs", "computedAt")
       SELECT gen_random_uuid(), $2, $1, q."questionId",
              COUNT(*)::int,
              COUNT(*) FILTER (WHERE q.result = 'CORRECT')::int,
              COUNT(*) FILTER (WHERE q.result = 'INCORRECT')::int,
              COUNT(*) FILTER (WHERE q.result = 'UNANSWERED')::int,
              AVG(q."timeMs")::int,
              AVG(q."timeMs") FILTER (WHERE q.result = 'CORRECT')::int,
              COUNT(*) FILTER (WHERE a.score >= $3)::int,
              COUNT(*) FILTER (WHERE a.score >= $3 AND q.result = 'CORRECT')::int,
              AVG(q."timeMs") FILTER (WHERE a.score >= $3)::int,
              NOW()
         FROM "ExamAttemptQuestion" q
         JOIN "ExamAttempt" a ON a.id = q."attemptId"
        WHERE a."testId" = $1 AND a."finalizedAt" IS NOT NULL AND a.score IS NOT NULL
        GROUP BY q."questionId"
       ON CONFLICT ("testId", "questionId") DO UPDATE SET
         attempts = EXCLUDED.attempts, correct = EXCLUDED.correct, incorrect = EXCLUDED.incorrect,
         unanswered = EXCLUDED.unanswered, "avgTimeMs" = EXCLUDED."avgTimeMs",
         "avgTimeCorrectMs" = EXCLUDED."avgTimeCorrectMs", "topperAttempts" = EXCLUDED."topperAttempts",
         "topperCorrect" = EXCLUDED."topperCorrect", "topperAvgTimeMs" = EXCLUDED."topperAvgTimeMs",
         "computedAt" = NOW()`,
      testId,
      tenantId,
      top10Cutoff,
    );
  }

  /**
   * Per-subject averages for everyone, the top 10% and the top 25%: marks, the
   * correct / incorrect / skipped / not-seen split, time on right and wrong
   * answers, and how many questions landed in each attempt behaviour — plus the
   * same split by difficulty. Behaviour is classified here in SQL with exactly
   * the rules of analytics-behaviour.logic.ts (never-opened folds into Left),
   * which is why this runs after questionStats has written the class timings.
   */
  private async subjectStats(testId: string): Promise<CohortStatsJson> {
    const yardstick = `COALESCE(s."avgTimeCorrectMs", s."avgTimeMs")`;
    const behaviour = `CASE
         WHEN q.visits = 0 THEN 'LEFT'
         WHEN q.result IN ('DROPPED','NOT_EVALUATED') THEN 'UNCLASSIFIED'
         WHEN s.attempts IS NULL OR s.attempts < ${MIN_CLASS_ATTEMPTS} OR ${yardstick} IS NULL THEN 'UNCLASSIFIED'
         WHEN q.result IN ('CORRECT','PARTIAL') THEN CASE WHEN q."timeMs" < ${yardstick} THEN 'SOLID' ELSE 'SLOW' END
         WHEN q.result = 'INCORRECT' THEN CASE WHEN q."timeMs" < ${yardstick} THEN 'RUSHED' ELSE 'WASTED' END
         ELSE CASE WHEN q."timeMs" < ${yardstick} THEN 'LEFT' ELSE 'STUCK' END
       END`;
    const groups = `grouped AS (
         SELECT 'all' AS grp, per.* FROM per
         UNION ALL SELECT 'top10', per.* FROM per WHERE rnk <= GREATEST(1, CEIL(total * 0.10))
         UNION ALL SELECT 'top25', per.* FROM per WHERE rnk <= GREATEST(1, CEIL(total * 0.25)))`;
    const ranked = `ranked AS (
         SELECT id, RANK() OVER (ORDER BY score DESC) AS rnk, COUNT(*) OVER () AS total
           FROM "ExamAttempt" WHERE ${AnalyticsComputeService.COHORT})`;
    const buckets = `
                COUNT(*) FILTER (WHERE q.visits > 0 AND q.result IN ('CORRECT','PARTIAL')) AS correct,
                COUNT(*) FILTER (WHERE q.visits > 0 AND q.result = 'INCORRECT') AS incorrect,
                COUNT(*) FILTER (WHERE q.visits > 0 AND q.result NOT IN ('CORRECT','PARTIAL','INCORRECT')) AS skipped,
                COUNT(*) FILTER (WHERE q.visits = 0) AS not_seen,
                COUNT(*) AS total_q`;

    const subjectRows = await this.prisma.$queryRawUnsafe<
      Record<string, unknown>[]
    >(
      `WITH ${ranked},
       per AS (
         SELECT r.id, r.rnk, r.total, q."subjectName" AS subject,
                SUM(q.marks) AS score, SUM(COALESCE(q."maxMarks", 0)) AS max_marks, SUM(q."timeMs") AS time_ms,
                COALESCE(SUM(q."timeMs") FILTER (WHERE q.result IN ('CORRECT','PARTIAL')), 0) AS time_correct,
                COALESCE(SUM(q."timeMs") FILTER (WHERE q.result = 'INCORRECT'), 0) AS time_wrong,
                ${buckets},
                COUNT(*) FILTER (WHERE cls.b = 'SOLID') AS b_solid,
                COUNT(*) FILTER (WHERE cls.b = 'SLOW') AS b_slow,
                COUNT(*) FILTER (WHERE cls.b = 'WASTED') AS b_wasted,
                COUNT(*) FILTER (WHERE cls.b = 'RUSHED') AS b_rushed,
                COUNT(*) FILTER (WHERE cls.b = 'STUCK') AS b_stuck,
                COUNT(*) FILTER (WHERE cls.b = 'LEFT') AS b_left,
                COUNT(*) FILTER (WHERE cls.b = 'UNCLASSIFIED') AS b_unclassified
           FROM ranked r
           JOIN "ExamAttemptQuestion" q ON q."attemptId" = r.id
           LEFT JOIN "TestQuestionStat" s ON s."testId" = $1 AND s."questionId" = q."questionId"
           CROSS JOIN LATERAL (SELECT ${behaviour} AS b) cls
          WHERE q."subjectName" IS NOT NULL
          GROUP BY r.id, r.rnk, r.total, q."subjectName"),
       ${groups}
       SELECT grp, subject,
              AVG(score) AS score, AVG(max_marks) AS max_marks, AVG(time_ms) AS time_ms,
              AVG(time_correct) AS time_correct, AVG(time_wrong) AS time_wrong,
              AVG(correct) AS correct, AVG(incorrect) AS incorrect, AVG(skipped) AS skipped, AVG(not_seen) AS not_seen,
              AVG(correct + incorrect) AS attempted,
              AVG(CASE WHEN correct + incorrect > 0 THEN 100.0 * correct / (correct + incorrect) END) AS accuracy,
              AVG(b_solid) AS b_solid, AVG(b_slow) AS b_slow, AVG(b_wasted) AS b_wasted, AVG(b_rushed) AS b_rushed,
              AVG(b_stuck) AS b_stuck, AVG(b_left) AS b_left, AVG(b_unclassified) AS b_unclassified
         FROM grouped GROUP BY grp, subject ORDER BY grp, subject`,
      testId,
    );

    const difficultyRows = await this.prisma.$queryRawUnsafe<
      Record<string, unknown>[]
    >(
      `WITH ${ranked},
       per AS (
         SELECT r.id, r.rnk, r.total, q."subjectName" AS subject, q.difficulty AS level, ${buckets}
           FROM ranked r JOIN "ExamAttemptQuestion" q ON q."attemptId" = r.id
          WHERE q."subjectName" IS NOT NULL AND q.difficulty IS NOT NULL
          GROUP BY r.id, r.rnk, r.total, q."subjectName", q.difficulty),
       ${groups}
       SELECT grp, subject, level,
              AVG(correct) AS correct, AVG(incorrect) AS incorrect, AVG(skipped) AS skipped,
              AVG(not_seen) AS not_seen, AVG(total_q) AS total_q
         FROM grouped GROUP BY grp, subject, level`,
      testId,
    );

    const r2 = (v: unknown) => round2(v) ?? 0;
    const out: CohortStatsJson = {
      version: COHORT_STATS_VERSION,
      all: {},
      top10: {},
      top25: {},
      difficulty: { all: {}, top10: {}, top25: {} },
    };
    for (const row of subjectRows) {
      const grp = row.grp as CohortGroup;
      out[grp][row.subject as string] = {
        score: r2(row.score),
        maxMarks: r2(row.max_marks),
        timeMs: Math.round(num(row.time_ms) ?? 0),
        accuracy: r2(row.accuracy),
        correct: r2(row.correct),
        incorrect: r2(row.incorrect),
        skipped: r2(row.skipped),
        notSeen: r2(row.not_seen),
        attempted: r2(row.attempted),
        timeCorrectMs: Math.round(num(row.time_correct) ?? 0),
        timeWrongMs: Math.round(num(row.time_wrong) ?? 0),
        behaviour: {
          SOLID: r2(row.b_solid),
          SLOW: r2(row.b_slow),
          WASTED: r2(row.b_wasted),
          RUSHED: r2(row.b_rushed),
          STUCK: r2(row.b_stuck),
          LEFT: r2(row.b_left),
          UNCLASSIFIED: r2(row.b_unclassified),
        },
      };
    }
    for (const row of difficultyRows) {
      const grp = row.grp as CohortGroup;
      const subject = row.subject as string;
      const bySubject = (out.difficulty[grp][subject] ??= {});
      bySubject[row.level as string] = {
        correct: r2(row.correct),
        incorrect: r2(row.incorrect),
        skipped: r2(row.skipped),
        notSeen: r2(row.not_seen),
        total: r2(row.total_q),
      };
    }
    return out;
  }

  /** How the cohort did by difficulty, for the Difficulty Breakup. */
  private async difficultyStats(
    testId: string,
  ): Promise<
    Record<string, { attempts: number; accuracy: number; avgTimeMs: number }>
  > {
    const rows = await this.prisma.$queryRawUnsafe<
      {
        difficulty: string | null;
        attempts: bigint;
        accuracy: number | null;
        avg_time: number | null;
      }[]
    >(
      `SELECT q.difficulty,
              COUNT(*)::bigint AS attempts,
              AVG(CASE WHEN q.result = 'CORRECT' THEN 100.0 WHEN q.result IN ('INCORRECT','PARTIAL') THEN 0 END) AS accuracy,
              AVG(q."timeMs") AS avg_time
         FROM "ExamAttemptQuestion" q
         JOIN "ExamAttempt" a ON a.id = q."attemptId"
        WHERE a."testId" = $1 AND a."finalizedAt" IS NOT NULL AND a.score IS NOT NULL AND q.difficulty IS NOT NULL
        GROUP BY q.difficulty`,
      testId,
    );
    const out: Record<
      string,
      { attempts: number; accuracy: number; avgTimeMs: number }
    > = {};
    for (const row of rows) {
      if (!row.difficulty) continue;
      out[row.difficulty] = {
        attempts: Number(row.attempts),
        accuracy: round2(row.accuracy) ?? 0,
        avgTimeMs: Math.round(num(row.avg_time) ?? 0),
      };
    }
    return out;
  }

  /**
   * Tests whose analytics no longer match the attempts on record — a new batch
   * finished, or a recompute was missed. Cheap enough to run every few minutes.
   */
  async staleTests(limit = 50): Promise<string[]> {
    const rows = await this.prisma.$queryRawUnsafe<{ testId: string }[]>(
      `SELECT a."testId" AS "testId"
         FROM "ExamAttempt" a
         LEFT JOIN "TestAnalytics" t ON t."testId" = a."testId"
        WHERE a."finalizedAt" IS NOT NULL AND a.score IS NOT NULL
        GROUP BY a."testId", t."attemptCount", t."subjectStats"->>'version'
       HAVING t."attemptCount" IS NULL OR t."attemptCount" <> COUNT(*)
           OR COALESCE(t."subjectStats"->>'version', '') <> '${COHORT_STATS_VERSION}'
        LIMIT $1`,
      limit,
    );
    return rows.map((r) => r.testId);
  }
}
