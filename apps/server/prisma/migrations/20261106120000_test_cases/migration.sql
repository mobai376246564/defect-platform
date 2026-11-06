-- 自动化测试：测试用例、执行记录、用例结果
ALTER TABLE "Project" ADD COLUMN "testCaseSeq" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Project" ADD COLUMN "testRunSeq" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "TestCase" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "module" TEXT NOT NULL DEFAULT '',
    "title" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'P2',
    "precondition" TEXT NOT NULL DEFAULT '',
    "steps" TEXT[],
    "expected" TEXT[],
    "testData" TEXT NOT NULL DEFAULT '',
    "mode" TEXT NOT NULL DEFAULT 'auto',
    "manualReason" TEXT NOT NULL DEFAULT '',
    "env" TEXT NOT NULL DEFAULT '',
    "source" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "origin" TEXT NOT NULL DEFAULT 'manual',
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TestCase_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TestRun" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "env" TEXT NOT NULL DEFAULT '',
    "build" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'running',
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "TestRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TestCaseResult" (
    "id" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "caseId" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "executor" TEXT NOT NULL DEFAULT 'manual',
    "executedById" UUID,
    "note" TEXT NOT NULL DEFAULT '',
    "defectId" UUID,
    "defectCode" TEXT,
    "executedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TestCaseResult_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TestCase_projectId_seq_key" ON "TestCase"("projectId", "seq");
CREATE INDEX "TestCase_projectId_status_idx" ON "TestCase"("projectId", "status");
CREATE UNIQUE INDEX "TestRun_projectId_seq_key" ON "TestRun"("projectId", "seq");
CREATE INDEX "TestRun_projectId_createdAt_idx" ON "TestRun"("projectId", "createdAt" DESC);
CREATE UNIQUE INDEX "TestCaseResult_runId_caseId_key" ON "TestCaseResult"("runId", "caseId");
CREATE INDEX "TestCaseResult_caseId_idx" ON "TestCaseResult"("caseId");

ALTER TABLE "TestCase" ADD CONSTRAINT "TestCase_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TestRun" ADD CONSTRAINT "TestRun_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TestCaseResult" ADD CONSTRAINT "TestCaseResult_runId_fkey" FOREIGN KEY ("runId") REFERENCES "TestRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TestCaseResult" ADD CONSTRAINT "TestCaseResult_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "TestCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
