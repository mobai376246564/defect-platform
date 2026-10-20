-- 关键字模糊搜索（ILIKE '%词%'）用 trigram 索引；pg_trgm 是 PostgreSQL 自带的可信扩展，库的属主即可创建
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateIndex
CREATE INDEX "Defect_projectId_createdAt_idx" ON "Defect"("projectId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Defect_projectId_updatedAt_idx" ON "Defect"("projectId", "updatedAt" DESC);

-- CreateIndex
CREATE INDEX "Defect_projectId_statusRank_idx" ON "Defect"("projectId", "statusRank");

-- CreateIndex
CREATE INDEX "Defect_projectId_severityRank_idx" ON "Defect"("projectId", "severityRank");

-- CreateIndex
CREATE INDEX "Defect_reporterId_idx" ON "Defect"("reporterId");

-- CreateIndex
CREATE INDEX "Defect_moduleId_idx" ON "Defect"("moduleId");

-- CreateIndex
CREATE INDEX "Defect_title_trgm_idx" ON "Defect" USING GIN ("title" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Defect_description_trgm_idx" ON "Defect" USING GIN ("description" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Defect_logSummary_trgm_idx" ON "Defect" USING GIN ("logSummary" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Defect_code_trgm_idx" ON "Defect" USING GIN ("code" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "FeedbackReport_appId_receivedAt_idx" ON "FeedbackReport"("appId", "receivedAt");

