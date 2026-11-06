-- 自动化测试改为“用例文件”：一份需求文档一个文件（概览 / 测试点汇总 / 需求待确认 / 各模块工作表），
-- 结果直接记在用例上。原来的用例 / 执行记录表不再使用，直接删除（数据只有试用期导入的用例）。
DROP TABLE IF EXISTS "TestCaseResult";
DROP TABLE IF EXISTS "TestRun";
DROP TABLE IF EXISTS "TestCase";

ALTER TABLE "Project" DROP COLUMN IF EXISTS "testRunSeq";
ALTER TABLE "Project" DROP COLUMN IF EXISTS "testCaseSeq";
ALTER TABLE "Project" ADD COLUMN "testSuiteSeq" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "TestSuite" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "docName" TEXT NOT NULL DEFAULT '',
    "source" TEXT NOT NULL DEFAULT '',
    "notes" TEXT[],
    "sheets" JSONB NOT NULL,
    "round" INTEGER NOT NULL DEFAULT 1,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TestSuite_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TestCase" (
    "id" UUID NOT NULL,
    "suiteId" UUID NOT NULL,
    "sheet" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "module" TEXT NOT NULL DEFAULT '',
    "subModule" TEXT NOT NULL DEFAULT '',
    "testPoint" TEXT NOT NULL DEFAULT '',
    "title" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'P2',
    "caseType" TEXT NOT NULL DEFAULT '功能',
    "precondition" TEXT NOT NULL DEFAULT '',
    "steps" TEXT NOT NULL DEFAULT '',
    "expected" TEXT NOT NULL DEFAULT '',
    "actualResult" TEXT NOT NULL DEFAULT '',
    "result" TEXT NOT NULL DEFAULT 'pending',
    "remark" TEXT NOT NULL DEFAULT '',
    "mode" TEXT NOT NULL DEFAULT 'auto',
    "defectId" UUID,
    "defectCode" TEXT,
    "executor" TEXT,
    "executedById" UUID,
    "executedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TestCase_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TestQuestion" (
    "id" UUID NOT NULL,
    "suiteId" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "module" TEXT NOT NULL DEFAULT '',
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL DEFAULT '',
    "confirmer" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TestQuestion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TestRound" (
    "id" UUID NOT NULL,
    "suiteId" UUID NOT NULL,
    "round" INTEGER NOT NULL,
    "stats" JSONB NOT NULL,
    "results" JSONB NOT NULL,
    "finishedById" UUID,
    "finishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TestRound_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TestSuite_projectId_seq_key" ON "TestSuite"("projectId", "seq");
CREATE UNIQUE INDEX "TestCase_suiteId_code_key" ON "TestCase"("suiteId", "code");
CREATE INDEX "TestCase_suiteId_sheet_sortOrder_idx" ON "TestCase"("suiteId", "sheet", "sortOrder");
CREATE UNIQUE INDEX "TestQuestion_suiteId_seq_key" ON "TestQuestion"("suiteId", "seq");
CREATE UNIQUE INDEX "TestRound_suiteId_round_key" ON "TestRound"("suiteId", "round");

ALTER TABLE "TestSuite" ADD CONSTRAINT "TestSuite_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TestCase" ADD CONSTRAINT "TestCase_suiteId_fkey" FOREIGN KEY ("suiteId") REFERENCES "TestSuite"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TestQuestion" ADD CONSTRAINT "TestQuestion_suiteId_fkey" FOREIGN KEY ("suiteId") REFERENCES "TestSuite"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TestRound" ADD CONSTRAINT "TestRound_suiteId_fkey" FOREIGN KEY ("suiteId") REFERENCES "TestSuite"("id") ON DELETE CASCADE ON UPDATE CASCADE;
