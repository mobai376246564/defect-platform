#!/usr/bin/env bash
# 在线更新脚本：由管理后台“立即更新”在后台启动（也可在仓库根目录手动执行 bash deploy/pm2/self-update.sh）。
# 步骤：拉取 → 备份数据库 → 快进合并 → 依赖变化时 npm ci → 构建 → 数据库迁移 → pm2 重启 → 健康检查。
# 构建失败会回滚到更新前的提交并重新构建；迁移失败不回滚代码，状态里给出备份文件位置。
# 进度写入 $UPDATE_DIR/status.json，供服务端读取；输出由调用方重定向到 $UPDATE_DIR/update.log。
#
# 以下命令可用环境变量覆盖（测试用桩命令替换）：
#   UPDATE_DEPS_CMD、UPDATE_BUILD_CMD、UPDATE_MIGRATE_CMD、UPDATE_RESTART_CMD、UPDATE_BACKUP_CMD、UPDATE_HEALTH_URL

set -uo pipefail

ROOT="${UPDATE_REPO_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
DIR="${UPDATE_DIR:-$ROOT/.data/update}"
REMOTE="${UPDATE_REMOTE:-origin}"
BRANCH="${UPDATE_BRANCH:-main}"
STATUS="$DIR/status.json"
STEP="start"
TO=""
BACKUP=""

DEPS_CMD="${UPDATE_DEPS_CMD:-npm ci}"
BUILD_CMD="${UPDATE_BUILD_CMD:-npm run build}"
MIGRATE_CMD="${UPDATE_MIGRATE_CMD:-npm run db:deploy -w @defect/server}"
RESTART_CMD="${UPDATE_RESTART_CMD:-pm2 restart ${UPDATE_PM2_APPS:-defect-server defect-web}}"
HEALTH_URL="${UPDATE_HEALTH_URL:-http://127.0.0.1:${PORT:-3000}/api/v1/health}"

FROM=""
STARTED="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

json_escape() {
  local s=${1//\\/\\\\}
  s=${s//\"/\\\"}
  printf '%s' "${s//$'\n'/ }"
}

# state: running / succeeded / failed
FINISHED=0
write_status() {
  [ "$1" = running ] || FINISHED=1
  printf '{"state":"%s","step":"%s","message":"%s","from":"%s","to":"%s","backup":"%s","startedAt":"%s","updatedAt":"%s"}\n' \
    "$1" "$STEP" "$(json_escape "$2")" "$FROM" "$TO" "$(json_escape "$BACKUP")" "$STARTED" \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$STATUS.tmp" && mv -f "$STATUS.tmp" "$STATUS"
}

step() {
  STEP="$1"
  write_status running "$2"
  echo "== [$(date +%H:%M:%S)] $2"
}

fail() {
  echo "!! $1"
  write_status failed "$1"
  exit 1
}

run() {
  echo "\$ $*"
  bash -c "$*"
}

# 脚本意外退出（语法或运行时错误）时也要写下失败状态，否则页面会一直显示“进行中”
on_exit() {
  local code=$?
  if [ "$FINISHED" = 0 ]; then
    echo "!! 更新脚本意外退出（退出码 ${code}）"
    write_status failed "更新脚本意外退出（退出码 ${code}），请查看更新日志"
  fi
}
trap on_exit EXIT

mkdir -p "$DIR" || exit 1
cd "$ROOT" || exit 1
FROM="$(git rev-parse HEAD)"

# 构建失败时回到更新前的提交并重新构建，保证下次重启用的是可运行的版本
rollback() {
  echo "!! $1，回滚到 ${FROM:0:7}"
  git reset --keep "$FROM" && run "$BUILD_CMD"
  fail "$1，已回滚到原版本 ${FROM:0:7}"
}

find_pg_dump() {
  local c
  for c in "${PG_DUMP:-}" "$(command -v pg_dump 2>/dev/null)" "${PG_BIN_DIR:+$PG_BIN_DIR/pg_dump}" \
    /opt/homebrew/opt/postgresql@16/bin/pg_dump /usr/local/opt/postgresql@16/bin/pg_dump \
    "$ROOT"/node_modules/@embedded-postgres/*/native/bin/pg_dump; do
    if [ -n "$c" ] && [ -x "$c" ]; then
      echo "$c"
      return 0
    fi
  done
  return 1
}

echo "== 在线更新开始 $(date)，当前 ${FROM:0:7}，来源 $REMOTE/$BRANCH"

step fetch "拉取最新代码"
git fetch "$REMOTE" "$BRANCH" || fail "拉取失败，请检查网络和仓库访问权限"
TO="$(git rev-parse "$REMOTE/$BRANCH")"
if [ "$TO" = "$FROM" ]; then
  STEP="done"
  write_status succeeded "已是最新版本"
  echo "== 已是最新版本"
  exit 0
fi
git merge-base --is-ancestor HEAD "$REMOTE/$BRANCH" || fail "本地有远程没有的提交，无法自动更新，请手动处理"
[ -z "$(git status --porcelain --untracked-files=no)" ] || fail "代码目录有未提交的改动，无法自动更新，请先处理"

step backup "备份数据库"
if [ -n "${UPDATE_BACKUP_CMD:-}" ]; then
  run "$UPDATE_BACKUP_CMD" || fail "数据库备份失败"
  BACKUP="(自定义备份命令)"
else
  PG_DUMP_BIN="$(find_pg_dump)" || fail "找不到 pg_dump，无法备份数据库；可设置 PG_DUMP 指定路径"
  [ -n "${DATABASE_URL:-}" ] || fail "没有 DATABASE_URL，无法备份数据库"
  mkdir -p "$ROOT/.data/backups"
  BACKUP=".data/backups/defect-before-${TO:0:7}-$(date +%Y%m%d-%H%M%S).sql"
  # pg_dump 不认识 Prisma 连接串里的 ?schema= 等参数
  "$PG_DUMP_BIN" "${DATABASE_URL%%\?*}" >"$ROOT/$BACKUP" || fail "数据库备份失败"
  echo "备份：${BACKUP}（$(wc -c <"$ROOT/$BACKUP" | tr -d ' ') 字节）"
fi

step merge "合并新版本 ${TO:0:7}"
git merge --ff-only "$REMOTE/$BRANCH" || fail "合并失败"

if git diff --quiet "$FROM" "$TO" -- package-lock.json; then
  echo "依赖没有变化，跳过安装"
else
  step deps "安装依赖"
  run "$DEPS_CMD" || rollback "安装依赖失败"
fi

step build "构建"
run "$BUILD_CMD" || rollback "构建失败"

step migrate "数据库迁移"
run "$MIGRATE_CMD" || fail "数据库迁移失败，代码已是新版本但服务未重启；备份在 ${BACKUP:-（无）}"

step restart "重启服务"
run "$RESTART_CMD" || fail "重启失败，请在服务器上执行 pm2 ls 查看"

step verify "检查服务是否正常"
for _ in $(seq 1 30); do
  if curl -fsS -m 3 "$HEALTH_URL" >/dev/null 2>&1; then
    STEP="done"
    write_status succeeded "已更新到 ${TO:0:7}"
    echo "== 更新完成 ${FROM:0:7} → ${TO:0:7}"
    exit 0
  fi
  sleep 2
done
fail "服务重启后 60 秒内未通过健康检查，请在服务器上执行 pm2 logs defect-server 查看"
