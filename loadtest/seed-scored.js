/**
 * Bulk-inserts synthetic *scored* attempts for an existing test, to time the
 * analytics compute at a realistic cohort size. These skip the event pipeline on
 * purpose — the question here is how the aggregation behaves over millions of
 * per-question rows, not how events are ingested (ingest-load.js covers that).
 *
 *   node loadtest/seed-scored.js <testId> [attempts]
 */
const { prisma } = require('./lib');

async function main() {
  const [testId, countArg] = process.argv.slice(2);
  const count = Number(countArg ?? 10000);
  if (!testId) throw new Error('Usage: node loadtest/seed-scored.js <testId> [attempts]');

  const db = prisma();
  const test = await db.test.findUnique({ where: { id: testId }, select: { tenantId: true } });
  if (!test) throw new Error(`No test ${testId} in the load-test database`);
  const questions = await db.questionUsage.findMany({
    where: { usedInType: 'TEST', usedInId: testId },
    select: { questionId: true, orderIndex: true },
    orderBy: { orderIndex: 'asc' },
  });
  if (questions.length === 0) throw new Error('That test has no questions');
  console.log(`Seeding ${count} scored attempts × ${questions.length} questions = ${(count * questions.length).toLocaleString()} rows`);

  const started = Date.now();
  const batch = 2000;
  for (let from = 0; from < count; from += batch) {
    const n = Math.min(batch, count - from);
    // Scores spread over a realistic range so ranks, ties and cut-offs are meaningful.
    await db.$executeRawUnsafe(
      `INSERT INTO "ExamAttempt" (id, "tenantId", "testId", "userId", status, "startedAt", deadline, "finalizedAt",
                                  "submittedAt", score, "maxMarks", "timeUsedMs", summary, "updatedAt")
       SELECT 'bulk-${from}-' || i, $1, $2, 'bulk-user-' || ($3 + i), 'SUBMITTED',
              NOW() - INTERVAL '4 hours', NOW() - INTERVAL '1 hour', NOW(), NOW() - INTERVAL '1 hour',
              (random() * 300)::int, 300, (random() * 10800000)::int,
              '{"total":0,"subjects":{}}'::jsonb, NOW()
         FROM generate_series(1, $4) i`,
      test.tenantId,
      testId,
      from,
      n,
    );
    await db.$executeRawUnsafe(
      `INSERT INTO "ExamAttemptQuestion" (id, "attemptId", "questionId", "subjectName", "orderIndex", status, result,
                                          marks, evaluated, "timeMs", "hiddenMs", visits, "answerChanges")
       SELECT gen_random_uuid(), a.id, q."questionId", q.subject, q."orderIndex",
              CASE WHEN r.v < 0.15 THEN 'NOT_ANSWERED' ELSE 'ANSWERED' END,
              CASE WHEN r.v < 0.15 THEN 'UNANSWERED' WHEN r.v < 0.55 THEN 'CORRECT' ELSE 'INCORRECT' END,
              CASE WHEN r.v < 0.15 THEN 0 WHEN r.v < 0.55 THEN 4 ELSE -1 END,
              r.v >= 0.15, (30000 + random() * 120000)::int, 0, 1 + (random() * 2)::int, (random() * 2)::int
         FROM "ExamAttempt" a
         CROSS JOIN LATERAL (SELECT unnest($1::text[]) AS "questionId",
                                    unnest($2::int[]) AS "orderIndex",
                                    unnest($3::text[]) AS subject) q
         CROSS JOIN LATERAL (SELECT random() AS v) r
        WHERE a."testId" = $4 AND a.id LIKE 'bulk-${from}-%'`,
      questions.map((q) => q.questionId),
      questions.map((q) => q.orderIndex),
      questions.map((_, i) => ['Physics', 'Chemistry', 'Maths'][Math.floor(i / (questions.length / 3))] ?? 'Maths'),
      testId,
    );
    process.stdout.write(`\r  ${Math.min(from + batch, count)}/${count} attempts…`);
  }

  // Each attempt's own total, so ranks mean something.
  await db.$executeRawUnsafe(
    `UPDATE "ExamAttempt" a SET score = s.total
       FROM (SELECT "attemptId", SUM(marks) AS total FROM "ExamAttemptQuestion"
              WHERE "attemptId" LIKE 'bulk-%' GROUP BY "attemptId") s
      WHERE a.id = s."attemptId" AND a."testId" = $1`,
    testId,
  );
  console.log(`\n  done in ${Math.round((Date.now() - started) / 1000)}s`);
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
