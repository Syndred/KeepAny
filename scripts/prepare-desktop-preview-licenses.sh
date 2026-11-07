#!/usr/bin/env bash
set -euo pipefail

license_dir="$GITHUB_WORKSPACE/desktop-license-materials"
source_dir="$GITHUB_WORKSPACE/preview-source"
tools_dir="$RUNNER_TEMP/keepany-license-tool"
manifest="$source_dir/apps/desktop/src-tauri/Cargo.toml"
mkdir -p "$license_dir" "$tools_dir"
(cd "$source_dir" && node scripts/phase0/verify-third-party-license-materials.mjs --release)
cp "$source_dir/LICENSE" "$source_dir/NOTICE.md" "$license_dir/"
cp -R "$source_dir/legal/third-party" "$license_dir/web"
cp "${manifest%/*}/Cargo.lock" "$license_dir/Cargo.lock"
printf 'Source commit: %s\nDesktop build: %s\n' "$KEEPANY_EXPECTED_COMMIT" "$KEEPANY_BUILD_RUN" > "$license_dir/SOURCE.txt"

rustup toolchain install 1.99.1 --profile minimal
export RUSTUP_TOOLCHAIN=1.99.1
archive="$tools_dir/cargo-about-0.9.3-x86_64-unknown-linux-musl.tar.gz"
curl -fsSL --retry 3 --max-time 90 \
  'https://github.com/EmbarkStudios/cargo-about/releases/download/0.9.3/cargo-about-0.9.3-x86_64-unknown-linux-musl.tar.gz' \
  -o "$archive"
printf '3ad1e94ea1e63d69d1961f4fb15ccbbe9575d906111f96d2cb4dce6df48f71b4  %s\n' "$archive" | sha256sum -c
tar -xzf "$archive" -C "$tools_dir"
cargo_about=$(find "$tools_dir" -type f -name cargo-about -print -quit)
test -n "$cargo_about"
export PATH="${cargo_about%/*}:$PATH"

cat > "$tools_dir/about.toml" <<'CONFIG'
accepted = [
  "MIT", "Apache-2.0", "Apache-2.0 WITH LLVM-exception", "BSD-2-Clause",
  "BSD-3-Clause", "ISC", "Unicode-3.0", "Unicode-DFS-2016", "Zlib",
  "0BSD", "BSL-1.0", "CC0-1.0", "Unlicense", "MPL-2.0", "CDLA-Permissive-2.0",
]
targets = ["x86_64-pc-windows-msvc", "x86_64-apple-darwin", "aarch64-apple-darwin"]
ignore-build-dependencies = true
ignore-dev-dependencies = true
private = { ignore = true }
CONFIG

(
  cd "${manifest%/*}"
  cargo about init
  cargo about generate --locked --fail -c "$tools_dir/about.toml" -m "$manifest" \
    -o "$license_dir/rust-third-party.html" about.hbs
)
test -s "$license_dir/rust-third-party.html"
{
  for target in x86_64-pc-windows-msvc aarch64-apple-darwin x86_64-apple-darwin; do
    cargo metadata --manifest-path "$manifest" --locked --format-version 1 --filter-platform "$target" \
      | jq -r '.packages[] | select(.source != null) | [.name,.version,.manifest_path] | @tsv'
  done
} | sort -u > "$tools_dir/crate-paths.tsv"

while IFS=$'\t' read -r name version cargo_manifest; do
  crate_dir="${cargo_manifest%/*}"
  destination="$license_dir/rust-upstream/$name-$version"
  find "$crate_dir" -maxdepth 1 -type f \( -iname 'license*' -o -iname 'notice*' -o -iname 'copying*' -o -iname 'copyright*' \) \
    -exec install -D -t "$destination" {} +
done < "$tools_dir/crate-paths.tsv"

(cd "$license_dir" && zip -q -r "$GITHUB_WORKSPACE/release-assets/KeepAny-desktop-licenses.zip" .)
