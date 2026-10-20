-- MCP 审计记录冗余项目 id：报表按项目统计调用量时直接按 (projectId, createdAt) 计数
ALTER TABLE "McpAudit" ADD COLUMN "projectId" UUID;

UPDATE "McpAudit" a
SET "projectId" = d."projectId"
FROM "Defect" d
WHERE a."defectId" = d.id AND a."projectId" IS NULL;

CREATE INDEX "McpAudit_projectId_createdAt_idx" ON "McpAudit"("projectId", "createdAt");
