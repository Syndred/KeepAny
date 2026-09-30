#!/bin/zsh
set -euo pipefail

ROOT=${0:A:h:h}
PID_FILE="$ROOT/release/.local-demo-server.pid"
URL="http://127.0.0.1:4186"
cd "$ROOT"

if [[ ! -f release/web/index.html ]]; then
  print -u2 "缺少 release/web 构建产物，请使用仓库中完整的本地交付版本。"
  exit 1
fi
if ! command -v node >/dev/null || [[ ! -f node_modules/vite/bin/vite.js ]]; then
  print -u2 "缺少 Node.js 或项目依赖。请先在仓库根目录执行 pnpm install --frozen-lockfile。"
  exit 1
fi
if [[ -f "$PID_FILE" ]]; then
  old_pid=$(<"$PID_FILE")
  if [[ "$old_pid" == <-> ]] && kill -0 "$old_pid" 2>/dev/null; then
    command_line=$(ps -p "$old_pid" -o command=)
    if [[ "$command_line" == *"vite/bin/vite.js preview apps/web"*"--port 4186"* ]]; then
      print "KeepAny 英文演示已在运行：$URL （PID $old_pid）"
      exit 0
    fi
    print -u2 "PID 已被其他进程使用，请检查 $PID_FILE"
    exit 1
  fi
  rm -f "$PID_FILE"
fi

print "$$" > "$PID_FILE"
print "KeepAny 英文演示版启动中：$URL"
print "在另一个终端执行 ./release/stop-demo.command 停止。"
exec node node_modules/vite/bin/vite.js preview apps/web \
  --outDir ../../release/web --host 127.0.0.1 --port 4186 --strictPort
