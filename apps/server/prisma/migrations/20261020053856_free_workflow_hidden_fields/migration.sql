-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "hiddenFields" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- 默认工作流改为“自由流转”：仍在使用旧默认工作流（新建 → 确认 → 处理中 → 待代码审核 → 已解决 → 关闭）的项目，
-- 换成新的默认状态，并把缺陷状态按下表迁移，同时写入变更历史：
--   新建、已确认 → 待处理；处理中、待代码审核 → 处理中；已解决 → 待回归；已关闭 → 测试通过；已拒绝 → 不是bug
-- 自定义过工作流的项目（没有 in_review 状态或已有 mode 字段）保持不变。
CREATE TEMP TABLE "_classic_projects" AS
  SELECT id FROM "Project"
  WHERE workflow->>'mode' IS NULL
    AND workflow->>'initialState' = 'new'
    AND workflow->'states' @> '[{"key":"in_review"}]'::jsonb;

CREATE TEMP TABLE "_status_map" ("old" TEXT PRIMARY KEY, "new" TEXT NOT NULL, "category" TEXT NOT NULL);
INSERT INTO "_status_map" VALUES
  ('new', 'pending', 'todo'),
  ('confirmed', 'pending', 'todo'),
  ('in_progress', 'in_progress', 'doing'),
  ('in_review', 'in_progress', 'doing'),
  ('resolved', 'to_verify', 'verifying'),
  ('closed', 'passed', 'done'),
  ('rejected', 'not_bug', 'done');

INSERT INTO "DefectHistory" ("id", "defectId", "field", "oldValue", "newValue", "operatorId", "via", "createdAt")
  SELECT gen_random_uuid(), d.id, 'status', to_jsonb(d.status), to_jsonb(m."new"), NULL, 'system', now()
  FROM "Defect" d
  JOIN "_status_map" m ON m."old" = d.status
  WHERE d."projectId" IN (SELECT id FROM "_classic_projects") AND m."old" <> m."new";

UPDATE "Defect" d
  SET status = m."new", "statusCategory" = m."category"
  FROM "_status_map" m
  WHERE m."old" = d.status AND d."projectId" IN (SELECT id FROM "_classic_projects");

UPDATE "Project"
  SET workflow = '{"mode":"free","initialState":"pending","states":[{"key":"pending","name":"待处理","category":"todo","color":"#1677ff"},{"key":"in_progress","name":"处理中","category":"doing","color":"#fa8c16"},{"key":"to_verify","name":"待回归","category":"verifying","color":"#13c2c2"},{"key":"passed","name":"测试通过","category":"done","color":"#52c41a"},{"key":"reopened","name":"重新打开","category":"doing","color":"#f5222d"},{"key":"not_bug","name":"不是bug","category":"done","color":"#8c8c8c"}],"transitions":[],"mergeTarget":"to_verify"}'::jsonb
  WHERE id IN (SELECT id FROM "_classic_projects");

DROP TABLE "_status_map";
DROP TABLE "_classic_projects";
