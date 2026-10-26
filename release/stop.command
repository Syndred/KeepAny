#!/bin/zsh
set -euo pipefail

ROOT=${0:A:h:h}
PID_FILE="$ROOT/release/.local-server.pid"
if [[ ! -f "$PID_FILE" ]]; then
  print "KeepAny 本地服务未运行。"
  exit 0
fi
pid=$(<"$PID_FILE")
if [[ "$pid" != <-> ]]; then
  print -u2 "PID 文件异常，请手工检查 $PID_FILE"
  exit 1
fi
if ! kill -0 "$pid" 2>/dev/null; then
  rm -f "$PID_FILE"
  print "KeepAny 本地服务已停止。"
  exit 0
fi
command_line=$(ps -p "$pid" -o command=)
if [[ "$command_line" != *"vite/bin/vite.js preview apps/web"*"--port 4180"* ]]; then
  print -u2 "PID 已被其他进程使用，未发送停止信号。"
  exit 1
fi
kill "$pid"
for attempt in {1..50}; do
  if ! kill -0 "$pid" 2>/dev/null; then
    rm -f "$PID_FILE"
    print "KeepAny 本地服务已停止。"
    exit 0
  fi
  sleep 0.1
done
print -u2 "停止超时，请检查 PID $pid。"
exit 1
