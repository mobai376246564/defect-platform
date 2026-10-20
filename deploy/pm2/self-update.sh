#!/usr/bin/env bash
# 在线更新脚本：由管理后台“立即更新”在后台启动（也可在仓库根目录手动执行 bash deploy/pm2/self-update.sh）。
#
# 采用“发布目录 + 软链切换”，正在运行的版本在新版本准备好之前完全不受影响：
#   拉取 → 备份数据库 → 在 .releases/<版本>/ 里准备代码、安装依赖、构建 → 数据库迁移
#   → .releases/current 切到新版本 → pm2 重启 → 健康检查；不通过时切回上一版本并重启。
# 依赖没变化时从上一版本复制 node_modules（APFS / Linux 上是写时复制或硬链接，几乎不占时间和空间）。
# 仓库目录（git、apps/server/.env、.data）由各版本共享；发布目录里的 .env、.data 是指向它们的软链。
# 更新成功后仓库目录快进到新版本，保留最近几个版本目录与数据库备份。
# 进度写入 $UPDATE_DIR/status.json，供服务端读取；输出由调用方重定向到 $UPDATE_DIR/update.log。
#
# 以下命令可用环境变量覆盖（测试用桩命令替换）：
#   UPDATE_DEPS_CMD、UPDATE_BUILD_CMD、UPDATE_MIGRATE_CMD、UPDATE_RESTART_CMD、UPDATE_BACKUP_CMD、
#   UPDATE_HEALTH_URL、UPDATE_WEB_HEALTH_URL（设为空则不检查网页）

set -uo pipefail

ROOT="${UPDATE_REPO_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
DIR="${UPDATE_DIR:-$ROOT/.data/update}"
REMOTE="${UPDATE_REMOTE:-origin}"
BRANCH="${UPDATE_BRANCH:-main}"
RELEASES="${UPDATE_RELEASES_DIR:-$ROOT/.releases}"
CURRENT="$RELEASES/current"
KEEP_RELEASES="${UPDATE_KEEP_RELEASES:-3}"
KEEP_BACKUPS="${UPDATE_KEEP_BACKUPS:-10}"
STATUS="$DIR/status.json"
STEP="start"
TO=""
BACKUP=""

DEPS_CMD="${UPDATE_DEPS_CMD:-npm ci --no-audit --no-fund}"
BUILD_CMD="${UPDATE_BUILD_CMD:-npm run build}"
MIGRATE_CMD="${UPDATE_MIGRATE_CMD:-npm run db:deploy -w @defect/server}"
# 删除后按新版本的 ecosystem 重新启动：进程的目录、端口、nginx 配置等改动都能生效
RESTART_CMD="${UPDATE_RESTART_CMD:-pm2 delete defect-server defect-web >/dev/null 2>&1; pm2 start \"$CURRENT/deploy/pm2/ecosystem.config.cjs\" --only defect-server,defect-web && pm2 save}"
HEALTH_URL="${UPDATE_HEALTH_URL:-http://127.0.0.1:${PORT:-3000}/api/v1/health}"
WEB_HEALTH_URL="${UPDATE_WEB_HEALTH_URL-http://127.0.0.1:${WEB_PORT:-5180}/}"
# 健康检查次数，每次间隔 2 秒
HEALTH_TRIES="${UPDATE_HEALTH_TRIES:-30}"

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

# 在发布目录里执行命令
run_in() {
  local dir="$1"
  shift
  echo "\$ (cd ${dir}) $*"
  (cd "$dir" && bash -c "$*")
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

find_pg_dump() {
  local c
  # 优先与数据库同版本的 pg_dump（系统 PostgreSQL 或嵌入式自带的），系统 PATH 里的可能版本过低
  for c in "${PG_DUMP:-}" "${PG_BIN_DIR:+$PG_BIN_DIR/pg_dump}" \
    /opt/homebrew/opt/postgresql@16/bin/pg_dump /usr/local/opt/postgresql@16/bin/pg_dump \
    "$ROOT"/node_modules/@embedded-postgres/*/native/bin/pg_dump "$(command -v pg_dump 2>/dev/null)"; do
    if [ -n "$c" ] && [ -x "$c" ]; then
      echo "$c"
      return 0
    fi
  done
  return 1
}

# 复制目录：优先写时复制（macOS APFS 的 cp -c）或硬链接（Linux 的 cp -al），都失败再普通复制
clone_dir() {
  cp -cR "$1" "$2" 2>/dev/null || cp -al "$1" "$2" 2>/dev/null || cp -R "$1" "$2"
}

# 当前运行的版本目录（还没用过发布目录时为空）
PREV=""
if [ -L "$CURRENT" ]; then
  PREV="$(cd "$CURRENT" 2>/dev/null && pwd -P)" || PREV=""
fi

echo "== 在线更新开始 $(date)，当前 ${FROM:0:7}，来源 $REMOTE/$BRANCH"

step fetch "拉取最新代码"
git fetch "$REMOTE" "$BRANCH" || fail "拉取失败，请检查网络和仓库访问权限"
TO="$(git rev-parse "$REMOTE/$BRANCH")"
# 已是最新且已在用发布目录时无事可做；还没用过发布目录时照常执行一次，完成切换
if [ "$TO" = "$FROM" ] && [ -n "$PREV" ]; then
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
  # 只保留最近几份备份
  ls -1t "$ROOT"/.data/backups/defect-before-*.sql 2>/dev/null | tail -n +$((KEEP_BACKUPS + 1)) | while read -r old; do
    rm -f "$old" && echo "删除旧备份：${old##*/}"
  done
fi

REL="$RELEASES/${TO:0:12}"
STAGE="$REL.staging"

step prepare "准备新版本 ${TO:0:7} 的目录"
mkdir -p "$RELEASES" || fail "无法创建发布目录 $RELEASES"
rm -rf "$STAGE"
mkdir -p "$STAGE" || fail "无法创建发布目录 $STAGE"
git archive "$TO" | tar -x -C "$STAGE" || fail "导出新版本代码失败"
# 共享的配置与数据
[ -e "$ROOT/apps/server/.env" ] && ln -s "$ROOT/apps/server/.env" "$STAGE/apps/server/.env"
mkdir -p "$ROOT/.data" && ln -s "$ROOT/.data" "$STAGE/.data"

# 任何一步失败：删掉准备了一半的目录，正在运行的版本不受影响
abort() {
  rm -rf "$STAGE"
  fail "${1}，正在运行的版本不受影响"
}

if [ -n "$PREV" ] && [ -d "$PREV/node_modules" ] && cmp -s "$PREV/package-lock.json" "$STAGE/package-lock.json"; then
  step deps "依赖没有变化，复用上一版本的依赖"
  for d in node_modules apps/*/node_modules packages/*/node_modules; do
    [ -d "$PREV/$d" ] && [ -d "$STAGE/$(dirname "$d")" ] && clone_dir "$PREV/$d" "$STAGE/$d"
  done
  [ -d "$STAGE/node_modules" ] || abort "复制依赖失败"
else
  step deps "安装依赖"
  run_in "$STAGE" "$DEPS_CMD" || abort "安装依赖失败"
fi

step build "构建"
# 发布目录里没有 .git，构建时用 APP_COMMIT 告诉网页当前版本
run_in "$STAGE" "export APP_COMMIT=$TO; $BUILD_CMD" || abort "构建失败"
rm -rf "$REL"
mv "$STAGE" "$REL" || abort "整理发布目录失败"

step migrate "数据库迁移"
run_in "$REL" "$MIGRATE_CMD" || fail "数据库迁移失败，服务未切换，仍在运行原版本；备份在 ${BACKUP:-（无）}"

step restart "切换到新版本并重启服务"
ln -sfn "$REL" "$CURRENT" || fail "切换版本失败"
run "$RESTART_CMD" || echo "!! 重启命令返回错误，继续检查服务状态"

healthy() {
  local i
  for i in $(seq 1 "$HEALTH_TRIES"); do
    if curl -fsS -m 3 "$HEALTH_URL" >/dev/null 2>&1 &&
      { [ -z "$WEB_HEALTH_URL" ] || curl -fsS -m 3 "$WEB_HEALTH_URL" >/dev/null 2>&1; }; then
      return 0
    fi
    [ "$i" -lt "$HEALTH_TRIES" ] && sleep 2
  done
  return 1
}

step verify "检查服务是否正常"
if ! healthy; then
  if [ -n "$PREV" ] && [ -d "$PREV" ]; then
    echo "!! 新版本未通过健康检查，切回 ${PREV##*/}"
    ln -sfn "$PREV" "$CURRENT"
    run "$RESTART_CMD"
    fail "新版本 60 秒内未通过健康检查，已切回原版本；请在服务器上执行 pm2 logs defect-server 查看原因"
  fi
  fail "服务重启后 60 秒内未通过健康检查，请在服务器上执行 pm2 logs defect-server 查看"
fi

# 仓库目录快进到新版本：版本检查、下次更新都以它为准
if [ "$TO" != "$FROM" ]; then
  git merge --ff-only "$REMOTE/$BRANCH" >/dev/null || echo "!! 仓库目录快进失败，不影响运行，请手动执行 git merge --ff-only"
fi

# 只保留最近几个版本目录（正在运行的和上一个一定保留）。按目录名比较：
# PREV 是解析软链后的真实路径（macOS 上 /tmp 会变成 /private/tmp），与列出的路径写法可能不同
ls -1dt "$RELEASES"/*/ 2>/dev/null | sed 's#/$##' | while read -r old; do
  case "${old##*/}" in "${REL##*/}" | "${PREV##*/}" | current | *.staging) continue ;; esac
  echo "$old"
done | tail -n +"$((KEEP_RELEASES - 1))" | while read -r old; do
  rm -rf "$old" && echo "删除旧版本目录：${old##*/}"
done

STEP="done"
write_status succeeded "已更新到 ${TO:0:7}"
echo "== 更新完成 ${FROM:0:7} → ${TO:0:7}"
exit 0
