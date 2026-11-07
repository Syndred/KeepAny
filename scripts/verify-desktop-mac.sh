#!/usr/bin/env bash
set -euo pipefail

candidate=$1
temp_dir=$(mktemp -d)
temp_dir=$(cd "$temp_dir" && pwd -P)
mount="$temp_dir/mount"
app="$temp_dir/KeepAny.app"
executable="$app/Contents/MacOS/keepany"
mkdir "$mount"
mounted=false
app_pid=
cleanup() {
  if [ -n "$app_pid" ] && kill -0 "$app_pid" 2>/dev/null; then kill -TERM "$app_pid"; fi
  if [ "$mounted" = true ]; then hdiutil detach "$mount"; fi
  rm -r -- "$temp_dir"
}
trap cleanup EXIT

dmg=("$candidate"/*.dmg)
if [ "${#dmg[@]}" -ne 1 ] || [ ! -f "${dmg[0]}" ]; then echo "Expected a single DMG" >&2; exit 1; fi
hdiutil attach "${dmg[0]}" -readonly -nobrowse -noautoopen -mountpoint "$mount"
mounted=true
ditto "$mount/KeepAny.app" "$app"
codesign --verify --deep --strict "$app"
[ "$(xcrun lipo -archs "$executable")" = "$(uname -m)" ]

cat > "$temp_dir/check-window.swift" <<'SWIFT'
import CoreGraphics
import Foundation

guard let pid = Int(CommandLine.arguments[1]) else { exit(2) }
let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID)
    as? [[String: Any]] ?? []
let visible = windows.contains { window in
    (window[kCGWindowOwnerPID as String] as? Int) == pid
        && (window[kCGWindowLayer as String] as? Int) == 0
}
exit(visible ? 0 : 1)
SWIFT
xcrun swiftc "$temp_dir/check-window.swift" -o "$temp_dir/check-window"

find_app_process() {
  local pid
  for pid in $(pgrep -x keepany || true); do
    if [ "$(ps -p "$pid" -o comm=)" = "$executable" ]; then
      printf '%s\n' "$pid"
      return
    fi
  done
}

for attempt in 1 2; do
  open -n "$app"
  visible=false
  for check in {1..40}; do
    app_pid=$(find_app_process)
    if [ -n "$app_pid" ] && "$temp_dir/check-window" "$app_pid"; then
      echo "Observed KeepAny window on $(uname -m), launch $attempt"
      visible=true
      break
    fi
    sleep 1
  done
  if [ "$visible" != true ]; then
    echo "KeepAny window did not appear, launch $attempt, matching process: ${app_pid:-none}" >&2
    pgrep -x keepany | xargs -n 1 ps -o pid=,comm= -p || true
    exit 1
  fi
  kill -TERM "$app_pid"
  for check in {1..30}; do
    if ! kill -0 "$app_pid" 2>/dev/null; then break; fi
    sleep 0.2
  done
  if kill -0 "$app_pid" 2>/dev/null; then echo "KeepAny did not exit" >&2; exit 1; fi
  app_pid=
done
