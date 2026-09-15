-- CreateEnum
CREATE TYPE "ExamAttemptStatus" AS ENUM ('IN_PROGRESS', 'SUBMITTED');

-- AlterTable
ALTER TABLE "Test" ADD COLUMN     "paperKey" TEXT,
ADD COLUMN     "paperSecret" TEXT;

-- CreateTable
CREATE TABLE "ExamAttempt" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "testId" TEXT NOT NULL,
    "seriesId" TEXT,
    "seriesNodeId" TEXT,
    "userId" TEXT NOT NULL,
    "userName" TEXT,
    "status" "ExamAttemptStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "startedAt" TIMESTAMP(3) NOT NULL,
    "deadline" TIMESTAMP(3) NOT NULL,
    "resultAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "submittedBy" TEXT,
    "submitReason" TEXT,
    "violations" INTEGER NOT NULL DEFAULT 0,
    "lastViolationT" INTEGER,
    "refreshes" INTEGER NOT NULL DEFAULT 0,
    "lastSeq" INTEGER NOT NULL DEFAULT 0,
    "chainHead" TEXT NOT NULL DEFAULT '0000000000000000000000000000000000000000000000000000000000000000',
    "lateSync" BOOLEAN NOT NULL DEFAULT false,
    "needsRecompute" BOOLEAN NOT NULL DEFAULT false,
    "score" DOUBLE PRECISION,
    "maxMarks" DOUBLE PRECISION,
    "summary" JSONB,
    "finalizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExamAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamEventBatch" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "fromSeq" INTEGER NOT NULL,
    "toSeq" INTEGER NOT NULL,
    "events" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExamEventBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamAttemptQuestion" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "subjectName" TEXT NOT NULL,
    "sectionId" TEXT,
    "orderIndex" INTEGER NOT NULL,
    "chapterId" TEXT,
    "topicId" TEXT,
    "difficulty" TEXT,
    "status" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "marks" DOUBLE PRECISION NOT NULL,
    "evaluated" BOOLEAN NOT NULL,
    "timeMs" INTEGER NOT NULL,
    "hiddenMs" INTEGER NOT NULL,
    "visits" INTEGER NOT NULL,
    "firstSeenMs" INTEGER,
    "firstAnsweredMs" INTEGER,
    "answerChanges" INTEGER NOT NULL,
    "answer" JSONB,

    CONSTRAINT "ExamAttemptQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExamAttempt_tenantId_testId_status_idx" ON "ExamAttempt"("tenantId", "testId", "status");

-- CreateIndex
CREATE INDEX "ExamAttempt_status_deadline_idx" ON "ExamAttempt"("status", "deadline");

-- CreateIndex
CREATE UNIQUE INDEX "ExamAttempt_testId_userId_key" ON "ExamAttempt"("testId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "ExamEventBatch_attemptId_fromSeq_key" ON "ExamEventBatch"("attemptId", "fromSeq");

-- CreateIndex
CREATE INDEX "ExamAttemptQuestion_questionId_idx" ON "ExamAttemptQuestion"("questionId");

-- CreateIndex
CREATE UNIQUE INDEX "ExamAttemptQuestion_attemptId_questionId_key" ON "ExamAttemptQuestion"("attemptId", "questionId");

-- AddForeignKey
ALTER TABLE "ExamAttempt" ADD CONSTRAINT "ExamAttempt_testId_fkey" FOREIGN KEY ("testId") REFERENCES "Test"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamEventBatch" ADD CONSTRAINT "ExamEventBatch_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "ExamAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamAttemptQuestion" ADD CONSTRAINT "ExamAttemptQuestion_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "ExamAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

