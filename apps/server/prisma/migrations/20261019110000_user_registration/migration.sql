-- 自助注册 + 管理员审核：新增登录账号、职位、账号状态；邮箱改为可选
ALTER TABLE "User" ADD COLUMN "username" TEXT;
ALTER TABLE "User" ADD COLUMN "position" TEXT NOT NULL DEFAULT 'other';
ALTER TABLE "User" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'active';
ALTER TABLE "User" ALTER COLUMN "email" DROP NOT NULL;

-- 旧用户回填账号：邮箱前缀符合账号规则且不重复时用前缀（admin@example.com → admin），否则用完整邮箱
UPDATE "User" u
SET "username" = CASE
  WHEN lower(split_part(u."email", '@', 1)) ~ '^[a-z0-9_.-]{3,32}$'
    AND (
      SELECT count(*) FROM "User" v
      WHERE lower(split_part(v."email", '@', 1)) = lower(split_part(u."email", '@', 1))
    ) = 1
  THEN lower(split_part(u."email", '@', 1))
  ELSE lower(u."email")
END;

ALTER TABLE "User" ALTER COLUMN "username" SET NOT NULL;
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
