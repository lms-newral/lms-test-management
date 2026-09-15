-- Analytics for a whole test, plus where each attempt stands in its cohort.
-- Additive and nullable: nothing existing changes meaning.

ALTER TABLE "ExamAttempt"
  ADD COLUMN IF NOT EXISTS "rank" INTEGER,
  ADD COLUMN IF NOT EXISTS "rankOutOf" INTEGER,
  ADD COLUMN IF NOT EXISTS "percentile" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "analyticsAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "TestAnalytics" (
  "tenantId" TEXT NOT NULL,
  "testId" TEXT NOT NULL,
  "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "meanScore" DOUBLE PRECISION,
  "medianScore" DOUBLE PRECISION,
  "topScore" DOUBLE PRECISION,
  "top10Cutoff" DOUBLE PRECISION,
  "top25Cutoff" DOUBLE PRECISION,
  "subjectStats" JSONB,
  "difficultyStats" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TestAnalytics_pkey" PRIMARY KEY ("testId")
);

CREATE INDEX IF NOT EXISTS "TestAnalytics_tenantId_idx" ON "TestAnalytics"("tenantId");

CREATE TABLE IF NOT EXISTS "TestQuestionStat" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "testId" TEXT NOT NULL,
  "questionId" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "correct" INTEGER NOT NULL DEFAULT 0,
  "incorrect" INTEGER NOT NULL DEFAULT 0,
  "unanswered" INTEGER NOT NULL DEFAULT 0,
  "avgTimeMs" INTEGER,
  "avgTimeCorrectMs" INTEGER,
  "topperAttempts" INTEGER,
  "topperCorrect" INTEGER,
  "topperAvgTimeMs" INTEGER,
  "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TestQuestionStat_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "TestQuestionStat_testId_questionId_key" ON "TestQuestionStat"("testId", "questionId");
CREATE INDEX IF NOT EXISTS "TestQuestionStat_testId_idx" ON "TestQuestionStat"("testId");
