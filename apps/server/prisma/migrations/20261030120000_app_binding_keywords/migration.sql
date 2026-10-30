-- APP 标识绑定改为关键字匹配（不区分大小写、包含即匹配），提交记录直接记下匹配到的项目
ALTER TABLE "FeedbackReport" ADD COLUMN "projectId" UUID;

-- 已建单的按缺陷所在项目，其余按原来的精确绑定回填
UPDATE "FeedbackReport" r SET "projectId" = d."projectId"
  FROM "Defect" d WHERE r."defectId" = d."id";
UPDATE "FeedbackReport" r SET "projectId" = p."id"
  FROM "Project" p WHERE r."projectId" IS NULL AND r."appId" = ANY(p."appIds");

DROP INDEX IF EXISTS "FeedbackReport_appId_receivedAt_idx";
CREATE INDEX "FeedbackReport_projectId_receivedAt_idx" ON "FeedbackReport"("projectId", "receivedAt");
