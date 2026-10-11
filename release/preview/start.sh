#!/bin/sh
set -eu
cd -- "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
if ! command -v node >/dev/null 2>&1; then
  echo '请先安装 Node.js 22 或更新版本。 / Install Node.js 22 or newer first.' >&2
  exit 1
fi
exec node ./preview-server.mjs start "$@"
