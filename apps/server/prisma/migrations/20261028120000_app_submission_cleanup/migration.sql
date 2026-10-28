-- 去掉已下线的“按崩溃特征合并重复反馈”留下的列与索引
DROP INDEX IF EXISTS "Defect_projectId_fingerprint_idx";
ALTER TABLE "Defect" DROP COLUMN "fingerprint", DROP COLUMN "dupCount";

-- APP 提单记录：manifest 列改存提交的字段，改名 meta；历史上“合并到已有缺陷”的记录归为已建单
ALTER TABLE "FeedbackReport" RENAME COLUMN "manifest" TO "meta";
UPDATE "FeedbackReport" SET "status" = 'created' WHERE "status" IN ('merged', 'archived') AND "defectId" IS NOT NULL;
UPDATE "FeedbackReport" SET "status" = 'failed' WHERE "status" IN ('merged', 'archived');
DROP INDEX IF EXISTS "FeedbackReport_status_idx";
CREATE INDEX "FeedbackReport_status_receivedAt_idx" ON "FeedbackReport"("status", "receivedAt");

-- 清理任务按存储路径判断上传是否已挂到缺陷；复盘报表按时间段查状态变更
CREATE INDEX "Attachment_storageKey_idx" ON "Attachment"("storageKey");
CREATE INDEX "DefectHistory_field_createdAt_idx" ON "DefectHistory"("field", "createdAt");
