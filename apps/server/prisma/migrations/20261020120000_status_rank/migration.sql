-- 按状态排序：记录状态在所属项目工作流中的顺序
ALTER TABLE "Defect" ADD COLUMN "statusRank" INTEGER NOT NULL DEFAULT 0;

UPDATE "Defect" d
SET "statusRank" = s.ord - 1
FROM "Project" p
CROSS JOIN LATERAL jsonb_array_elements(p.workflow->'states') WITH ORDINALITY AS s(state, ord)
WHERE d."projectId" = p.id
  AND s.state->>'key' = d.status;
