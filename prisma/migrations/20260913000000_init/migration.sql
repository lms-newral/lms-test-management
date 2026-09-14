-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "QuestionType" AS ENUM ('MCQ', 'TEXT', 'CODE');

-- CreateEnum
CREATE TYPE "TaxonomyKind" AS ENUM ('SUBJECT', 'CHAPTER', 'TOPIC', 'SUBTOPIC');

-- CreateEnum
CREATE TYPE "AnswerKernel" AS ENUM ('SINGLE_CHOICE', 'MULTI_CHOICE', 'NUMERIC', 'SHORT_TEXT', 'LONG_TEXT', 'MATCHING', 'ORDERING', 'CODE');

-- CreateEnum
CREATE TYPE "FieldType" AS ENUM ('TEXT', 'NUMBER', 'SELECT', 'MULTI_SELECT', 'BOOLEAN', 'DATE');

-- CreateEnum
CREATE TYPE "FieldRole" AS ENUM ('DIFFICULTY', 'SOURCE', 'LANGUAGE', 'COGNITIVE_LEVEL');

-- CreateEnum
CREATE TYPE "QuestionStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'RETIRED');

-- CreateEnum
CREATE TYPE "UsageType" AS ENUM ('TEST', 'QUIZ', 'POLL', 'LIVE_CLASS_MCQ', 'PRACTICE');

-- CreateEnum
CREATE TYPE "SolutionKind" AS ENUM ('TEXT', 'VIDEO', 'HINT');

-- CreateEnum
CREATE TYPE "SolutionVisibility" AS ENUM ('ALWAYS', 'AFTER_SUBMIT', 'AFTER_TEST_CLOSE');

-- CreateEnum
CREATE TYPE "VideoProvider" AS ENUM ('YOUTUBE', 'VIMEO', 'UPLOADED', 'EXTERNAL');

-- CreateTable
CREATE TABLE "Taxonomy" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" "TaxonomyKind" NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "parentId" TEXT,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMP(3),
    "deletedById" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Taxonomy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionTypeDef" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "kernel" "AnswerKernel" NOT NULL,
    "aliases" TEXT[],
    "config" JSONB,
    "layoutHint" TEXT,
    "icon" TEXT,
    "color" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuestionTypeDef_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DifficultyLevel" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "aliases" TEXT[],
    "color" TEXT,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DifficultyLevel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionFieldDef" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" "FieldType" NOT NULL,
    "role" "FieldRole",
    "required" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "helpText" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuestionFieldDef_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionFieldOption" (
    "id" TEXT NOT NULL,
    "defId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "weight" INTEGER,
    "color" TEXT,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "QuestionFieldOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionGroup" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "title" TEXT,
    "passageHtml" TEXT,
    "deletedAt" TIMESTAMP(3),
    "deletedById" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuestionGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Question" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "testId" TEXT,
    "createdById" TEXT NOT NULL,
    "questionText" TEXT NOT NULL,
    "questionType" "QuestionType" NOT NULL,
    "marks" INTEGER NOT NULL DEFAULT 1,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "mcqOptions" JSONB,
    "textConfig" JSONB,
    "codeConfig" JSONB,
    "isSelfExamined" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "allowPartialMarks" BOOLEAN NOT NULL DEFAULT false,
    "category" TEXT,
    "difficulty" TEXT DEFAULT 'medium',
    "explanation" TEXT,
    "hints" JSONB,
    "isTemplate" BOOLEAN NOT NULL DEFAULT false,
    "mediaType" TEXT,
    "mediaUrl" TEXT,
    "partialMarksRules" JSONB,
    "questionBankId" TEXT,
    "tags" TEXT[],
    "questionTypeId" TEXT,
    "groupId" TEXT,
    "subjectId" TEXT,
    "chapterId" TEXT,
    "topicId" TEXT,
    "subtopicId" TEXT,
    "customFields" JSONB,
    "answerConfig" JSONB,
    "difficultyId" TEXT,
    "status" "QuestionStatus" NOT NULL DEFAULT 'DRAFT',
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3),
    "deletedById" TEXT,
    "normalizedHash" TEXT,

    CONSTRAINT "Question_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionVersion" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "changedById" TEXT,
    "changeNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuestionVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionSolution" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "kind" "SolutionKind" NOT NULL,
    "contentHtml" TEXT,
    "videoProvider" "VideoProvider",
    "videoUrl" TEXT,
    "videoAssetId" TEXT,
    "durationSec" INTEGER,
    "language" TEXT,
    "visibility" "SolutionVisibility" NOT NULL DEFAULT 'AFTER_SUBMIT',
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuestionSolution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionUsage" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "usedInType" "UsageType" NOT NULL,
    "usedInId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "marks" DOUBLE PRECISION,
    "negativeMarks" DOUBLE PRECISION,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuestionUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestBlueprint" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "rules" JSONB NOT NULL,
    "totalMarks" INTEGER,
    "shuffle" BOOLEAN NOT NULL DEFAULT true,
    "seed" INTEGER,
    "excludeRecentCount" INTEGER,
    "deletedAt" TIMESTAMP(3),
    "deletedById" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TestBlueprint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionImportJob" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "fileKey" TEXT NOT NULL,
    "fileName" TEXT,
    "questionBankId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PARSING',
    "parsedCount" INTEGER NOT NULL DEFAULT 0,
    "importedCount" INTEGER NOT NULL DEFAULT 0,
    "report" JSONB,
    "failureReason" TEXT,
    "committedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuestionImportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionImportRow" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "rowIndex" INTEGER NOT NULL,
    "raw" JSONB,
    "questionTypeId" TEXT,
    "subjectId" TEXT,
    "chapterId" TEXT,
    "topicId" TEXT,
    "subtopicId" TEXT,
    "difficultyId" TEXT,
    "bodyHtml" TEXT,
    "optionsJson" JSONB,
    "answerConfig" JSONB,
    "solutionHtml" TEXT,
    "solutionVideoUrl" TEXT,
    "marks" INTEGER,
    "severity" TEXT NOT NULL DEFAULT 'OK',
    "issues" JSONB,
    "overrides" JSONB,
    "duplicateOfId" TEXT,
    "createdId" TEXT,
    "dropped" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuestionImportRow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Taxonomy_tenantId_kind_idx" ON "Taxonomy"("tenantId", "kind");

-- CreateIndex
CREATE INDEX "Taxonomy_parentId_idx" ON "Taxonomy"("parentId");

-- CreateIndex
CREATE INDEX "QuestionTypeDef_tenantId_isActive_idx" ON "QuestionTypeDef"("tenantId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionTypeDef_tenantId_code_key" ON "QuestionTypeDef"("tenantId", "code");

-- CreateIndex
CREATE INDEX "DifficultyLevel_tenantId_isActive_idx" ON "DifficultyLevel"("tenantId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "DifficultyLevel_tenantId_code_key" ON "DifficultyLevel"("tenantId", "code");

-- CreateIndex
CREATE INDEX "QuestionFieldDef_tenantId_isActive_idx" ON "QuestionFieldDef"("tenantId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionFieldDef_tenantId_key_key" ON "QuestionFieldDef"("tenantId", "key");

-- CreateIndex
CREATE INDEX "QuestionFieldOption_defId_idx" ON "QuestionFieldOption"("defId");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionFieldOption_defId_value_key" ON "QuestionFieldOption"("defId", "value");

-- CreateIndex
CREATE INDEX "QuestionGroup_tenantId_idx" ON "QuestionGroup"("tenantId");

-- CreateIndex
CREATE INDEX "Question_tenantId_testId_idx" ON "Question"("tenantId", "testId");

-- CreateIndex
CREATE INDEX "Question_testId_orderIndex_idx" ON "Question"("testId", "orderIndex");

-- CreateIndex
CREATE INDEX "Question_tenantId_status_deletedAt_idx" ON "Question"("tenantId", "status", "deletedAt");

-- CreateIndex
CREATE INDEX "Question_tenantId_subjectId_chapterId_topicId_idx" ON "Question"("tenantId", "subjectId", "chapterId", "topicId");

-- CreateIndex
CREATE INDEX "Question_tenantId_subjectId_chapterId_topicId_subtopicId_idx" ON "Question"("tenantId", "subjectId", "chapterId", "topicId", "subtopicId");

-- CreateIndex
CREATE INDEX "Question_subtopicId_idx" ON "Question"("subtopicId");

-- CreateIndex
CREATE INDEX "Question_questionBankId_idx" ON "Question"("questionBankId");

-- CreateIndex
CREATE INDEX "Question_groupId_idx" ON "Question"("groupId");

-- CreateIndex
CREATE INDEX "Question_normalizedHash_idx" ON "Question"("normalizedHash");

-- CreateIndex
CREATE INDEX "Question_difficultyId_idx" ON "Question"("difficultyId");

-- CreateIndex
CREATE INDEX "QuestionVersion_questionId_idx" ON "QuestionVersion"("questionId");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionVersion_questionId_version_key" ON "QuestionVersion"("questionId", "version");

-- CreateIndex
CREATE INDEX "QuestionSolution_questionId_idx" ON "QuestionSolution"("questionId");

-- CreateIndex
CREATE INDEX "QuestionSolution_tenantId_idx" ON "QuestionSolution"("tenantId");

-- CreateIndex
CREATE INDEX "QuestionUsage_questionId_idx" ON "QuestionUsage"("questionId");

-- CreateIndex
CREATE INDEX "QuestionUsage_usedInType_usedInId_idx" ON "QuestionUsage"("usedInType", "usedInId");

-- CreateIndex
CREATE INDEX "QuestionUsage_tenantId_idx" ON "QuestionUsage"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionUsage_usedInType_usedInId_questionId_key" ON "QuestionUsage"("usedInType", "usedInId", "questionId");

-- CreateIndex
CREATE INDEX "TestBlueprint_tenantId_idx" ON "TestBlueprint"("tenantId");

-- CreateIndex
CREATE INDEX "QuestionImportJob_tenantId_status_idx" ON "QuestionImportJob"("tenantId", "status");

-- CreateIndex
CREATE INDEX "QuestionImportRow_jobId_severity_idx" ON "QuestionImportRow"("jobId", "severity");

-- CreateIndex
CREATE INDEX "QuestionImportRow_tenantId_idx" ON "QuestionImportRow"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionImportRow_jobId_rowIndex_key" ON "QuestionImportRow"("jobId", "rowIndex");

-- AddForeignKey
ALTER TABLE "Taxonomy" ADD CONSTRAINT "Taxonomy_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Taxonomy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionFieldOption" ADD CONSTRAINT "QuestionFieldOption_defId_fkey" FOREIGN KEY ("defId") REFERENCES "QuestionFieldDef"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_questionTypeId_fkey" FOREIGN KEY ("questionTypeId") REFERENCES "QuestionTypeDef"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "QuestionGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Taxonomy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "Taxonomy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Taxonomy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_subtopicId_fkey" FOREIGN KEY ("subtopicId") REFERENCES "Taxonomy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_difficultyId_fkey" FOREIGN KEY ("difficultyId") REFERENCES "DifficultyLevel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionVersion" ADD CONSTRAINT "QuestionVersion_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionSolution" ADD CONSTRAINT "QuestionSolution_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionUsage" ADD CONSTRAINT "QuestionUsage_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionImportRow" ADD CONSTRAINT "QuestionImportRow_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "QuestionImportJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ─────────────────────────────────────────────────────────────────────────────
-- Partial unique indexes. NOT expressible as Prisma @@unique, so they live only
-- here, and `prisma migrate diff` / `db push` will never generate them. Keep
-- them when regenerating this file. (The main backend's production database
-- lost exactly these when its tables were rebuilt from a generated diff.)
--
-- Postgres treats NULLs as distinct, so a plain unique on
-- (tenantId, kind, parentId, name) would allow two root subjects both named
-- "Physics". Both indexes skip soft-deleted rows so a deleted name can be reused.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE UNIQUE INDEX "Taxonomy_tenant_kind_root_name_key"
    ON "Taxonomy"("tenantId", "kind", "name")
    WHERE "parentId" IS NULL AND "deletedAt" IS NULL;

CREATE UNIQUE INDEX "Taxonomy_tenant_kind_parent_name_key"
    ON "Taxonomy"("tenantId", "kind", "parentId", "name")
    WHERE "parentId" IS NOT NULL AND "deletedAt" IS NULL;

-- At most one active field per tenant may claim each system role, so that
-- "the difficulty field" is unambiguous for blueprint generation.
CREATE UNIQUE INDEX "QuestionFieldDef_tenant_role_key"
    ON "QuestionFieldDef"("tenantId", "role")
    WHERE "role" IS NOT NULL AND "isActive" = true AND "deletedAt" IS NULL;
