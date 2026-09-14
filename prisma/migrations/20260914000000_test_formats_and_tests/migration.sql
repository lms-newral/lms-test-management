-- Test management: formats, sections, rows, percentile bands, tests, syllabi,
-- picked questions. Strictly additive (generated diff, audited before deploy).

-- CreateEnum
CREATE TYPE "TestFormatStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "TestStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "TestFormat" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "name" TEXT NOT NULL,
    "status" "TestFormatStatus" NOT NULL DEFAULT 'DRAFT',
    "instructionsHtml" TEXT,
    "durationMinutes" INTEGER NOT NULL,
    "templateNote" TEXT,
    "sourceTemplateId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedById" TEXT,

    CONSTRAINT "TestFormat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestFormatSubject" (
    "id" TEXT NOT NULL,
    "formatId" TEXT NOT NULL,
    "subjectId" TEXT,
    "subjectName" TEXT NOT NULL,
    "totalQuestions" INTEGER NOT NULL,
    "totalMarks" DECIMAL(8,2) NOT NULL,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TestFormatSubject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestFormatSection" (
    "id" TEXT NOT NULL,
    "formatSubjectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "instructionsHtml" TEXT,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TestFormatSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestFormatRow" (
    "id" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "questionTypeId" TEXT,
    "questionTypeCode" TEXT NOT NULL,
    "kernel" "AnswerKernel" NOT NULL,
    "questionCount" INTEGER NOT NULL,
    "attemptLimit" INTEGER,
    "marksPerQuestion" DECIMAL(6,2) NOT NULL,
    "negativeMarks" DECIMAL(6,2) NOT NULL,
    "partialMarking" BOOLEAN NOT NULL DEFAULT false,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TestFormatRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestPercentileBand" (
    "id" TEXT NOT NULL,
    "formatId" TEXT NOT NULL,
    "minScore" DECIMAL(8,2) NOT NULL,
    "maxScore" DECIMAL(8,2) NOT NULL,
    "percentile" DECIMAL(5,2) NOT NULL,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TestPercentileBand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Test" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "formatId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "year" INTEGER,
    "descriptionHtml" TEXT,
    "plannerFileKey" TEXT,
    "plannerFileName" TEXT,
    "durationMinutes" INTEGER,
    "status" "TestStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMP(3),
    "publishedById" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedById" TEXT,

    CONSTRAINT "Test_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestSubjectSyllabus" (
    "id" TEXT NOT NULL,
    "testId" TEXT NOT NULL,
    "formatSubjectId" TEXT NOT NULL,
    "syllabusHtml" TEXT,

    CONSTRAINT "TestSubjectSyllabus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestQuestion" (
    "id" TEXT NOT NULL,
    "testId" TEXT NOT NULL,
    "rowId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TestQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TestFormat_tenantId_status_idx" ON "TestFormat"("tenantId", "status");

-- CreateIndex
CREATE INDEX "TestFormatSubject_formatId_idx" ON "TestFormatSubject"("formatId");

-- CreateIndex
CREATE UNIQUE INDEX "TestFormatSubject_formatId_subjectId_key" ON "TestFormatSubject"("formatId", "subjectId");

-- CreateIndex
CREATE INDEX "TestFormatSection_formatSubjectId_idx" ON "TestFormatSection"("formatSubjectId");

-- CreateIndex
CREATE INDEX "TestFormatRow_sectionId_idx" ON "TestFormatRow"("sectionId");

-- CreateIndex
CREATE INDEX "TestPercentileBand_formatId_idx" ON "TestPercentileBand"("formatId");

-- CreateIndex
CREATE INDEX "Test_tenantId_status_idx" ON "Test"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Test_formatId_idx" ON "Test"("formatId");

-- CreateIndex
CREATE UNIQUE INDEX "TestSubjectSyllabus_testId_formatSubjectId_key" ON "TestSubjectSyllabus"("testId", "formatSubjectId");

-- CreateIndex
CREATE INDEX "TestQuestion_testId_rowId_orderIndex_idx" ON "TestQuestion"("testId", "rowId", "orderIndex");

-- CreateIndex
CREATE INDEX "TestQuestion_questionId_idx" ON "TestQuestion"("questionId");

-- CreateIndex
CREATE UNIQUE INDEX "TestQuestion_testId_questionId_key" ON "TestQuestion"("testId", "questionId");

-- AddForeignKey
ALTER TABLE "TestFormatSubject" ADD CONSTRAINT "TestFormatSubject_formatId_fkey" FOREIGN KEY ("formatId") REFERENCES "TestFormat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestFormatSection" ADD CONSTRAINT "TestFormatSection_formatSubjectId_fkey" FOREIGN KEY ("formatSubjectId") REFERENCES "TestFormatSubject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestFormatRow" ADD CONSTRAINT "TestFormatRow_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "TestFormatSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestPercentileBand" ADD CONSTRAINT "TestPercentileBand_formatId_fkey" FOREIGN KEY ("formatId") REFERENCES "TestFormat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Test" ADD CONSTRAINT "Test_formatId_fkey" FOREIGN KEY ("formatId") REFERENCES "TestFormat"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestSubjectSyllabus" ADD CONSTRAINT "TestSubjectSyllabus_testId_fkey" FOREIGN KEY ("testId") REFERENCES "Test"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestSubjectSyllabus" ADD CONSTRAINT "TestSubjectSyllabus_formatSubjectId_fkey" FOREIGN KEY ("formatSubjectId") REFERENCES "TestFormatSubject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestQuestion" ADD CONSTRAINT "TestQuestion_testId_fkey" FOREIGN KEY ("testId") REFERENCES "Test"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestQuestion" ADD CONSTRAINT "TestQuestion_rowId_fkey" FOREIGN KEY ("rowId") REFERENCES "TestFormatRow"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestQuestion" ADD CONSTRAINT "TestQuestion_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

