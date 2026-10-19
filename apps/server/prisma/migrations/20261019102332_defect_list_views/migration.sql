-- AlterTable
ALTER TABLE "Defect" ADD COLUMN     "priorityRank" INTEGER,
ADD COLUMN     "severityRank" INTEGER NOT NULL DEFAULT 2;

-- CreateTable
CREATE TABLE "SavedView" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "shared" BOOLEAN NOT NULL DEFAULT false,
    "query" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedView_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SavedView_projectId_idx" ON "SavedView"("projectId");

-- AddForeignKey
ALTER TABLE "SavedView" ADD CONSTRAINT "SavedView_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 回填已有缺陷的等级（与 @defect/shared 的 SEVERITY_RANK、PRIORITY_RANK 一致）
UPDATE "Defect" SET "severityRank" = CASE "severity"
  WHEN 'fatal' THEN 0 WHEN 'serious' THEN 1 WHEN 'normal' THEN 2 WHEN 'prompt' THEN 3 WHEN 'advice' THEN 4 ELSE 2 END;
UPDATE "Defect" SET "priorityRank" = CASE "priority"
  WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 WHEN 'insignificant' THEN 4 ELSE NULL END;
