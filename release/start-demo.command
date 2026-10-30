#!/bin/sh
set -eu
if [ "$#" -ne 1 ] || [ ! -f "$1/RELEASE.json" ] || [ ! -f "$1/preview-server.mjs" ]; then
  echo "Usage: start-demo.command /absolute/path/to/verified-portable-directory" >&2
  exit 1
fi
case "$1" in /*) ;; *) echo "Use an absolute candidate directory." >&2; exit 1;; esac
exec node "$1/preview-server.mjs" start --port 4186
