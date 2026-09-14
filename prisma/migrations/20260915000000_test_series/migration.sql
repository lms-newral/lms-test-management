
-- CreateEnum
CREATE TYPE "TestSeriesStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'UNPUBLISHED');

-- CreateEnum
CREATE TYPE "TestSeriesNodeKind" AS ENUM ('FOLDER', 'TEST');

-- CreateTable
CREATE TABLE "TestSeries" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "classLevel" TEXT,
    "examType" TEXT,
    "targetYear" INTEGER,
    "descriptionHtml" TEXT,
    "isPaid" BOOLEAN NOT NULL DEFAULT false,
    "price" DECIMAL(10,2),
    "discountedPrice" DECIMAL(10,2),
    "startAt" TIMESTAMP(3),
    "endAt" TIMESTAMP(3),
    "status" "TestSeriesStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMP(3),
    "publishedById" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedById" TEXT,

    CONSTRAINT "TestSeries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestSeriesNode" (
    "id" TEXT NOT NULL,
    "seriesId" TEXT NOT NULL,
    "parentId" TEXT,
    "kind" "TestSeriesNodeKind" NOT NULL,
    "name" TEXT,
    "testId" TEXT,
    "availableFrom" TIMESTAMP(3),
    "availableTo" TIMESTAMP(3),
    "resultAt" TIMESTAMP(3),
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TestSeriesNode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestSeriesEnrollment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "seriesId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userName" TEXT,
    "userEmail" TEXT,
    "source" TEXT NOT NULL DEFAULT 'FREE',
    "amountPaid" DECIMAL(10,2),
    "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TestSeriesEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TestSeries_tenantId_status_idx" ON "TestSeries"("tenantId", "status");

-- CreateIndex
CREATE INDEX "TestSeriesNode_seriesId_parentId_orderIndex_idx" ON "TestSeriesNode"("seriesId", "parentId", "orderIndex");

-- CreateIndex
CREATE INDEX "TestSeriesNode_testId_idx" ON "TestSeriesNode"("testId");

-- CreateIndex
CREATE UNIQUE INDEX "TestSeriesNode_seriesId_testId_key" ON "TestSeriesNode"("seriesId", "testId");

-- CreateIndex
CREATE INDEX "TestSeriesEnrollment_tenantId_userId_idx" ON "TestSeriesEnrollment"("tenantId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "TestSeriesEnrollment_seriesId_userId_key" ON "TestSeriesEnrollment"("seriesId", "userId");

-- AddForeignKey
ALTER TABLE "TestSeriesNode" ADD CONSTRAINT "TestSeriesNode_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "TestSeries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestSeriesNode" ADD CONSTRAINT "TestSeriesNode_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "TestSeriesNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestSeriesNode" ADD CONSTRAINT "TestSeriesNode_testId_fkey" FOREIGN KEY ("testId") REFERENCES "Test"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestSeriesEnrollment" ADD CONSTRAINT "TestSeriesEnrollment_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "TestSeries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

