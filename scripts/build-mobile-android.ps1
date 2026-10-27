param(
  [string]$JavaPath = $env:JAVA_HOME,
  [string]$SdkPath = $env:ANDROID_HOME
)
$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (-not $JavaPath -or -not (Test-Path -LiteralPath (Join-Path $JavaPath 'bin/java.exe'))) { throw 'Set JAVA_HOME or pass -JavaPath for JDK 21+.' }
if (-not $SdkPath -or -not (Test-Path -LiteralPath (Join-Path $SdkPath 'platforms/android-36/android.jar'))) { throw 'Set ANDROID_HOME or pass -SdkPath for Android API 36.' }
$env:JAVA_HOME = [IO.Path]::GetFullPath($JavaPath)
$env:ANDROID_HOME = [IO.Path]::GetFullPath($SdkPath)
# JDK 21 Windows AF_UNIX selector pipes fail on some short-name TEMP aliases.
# Pass a persistent, short, process-local socket directory to every JVM,
# including Gradle's daemon. Gradle may strip ordinary -D flags at startup.
$taskSockets = Join-Path $env:USERPROFILE '.keepany-jvm'
New-Item -ItemType Directory -Path $taskSockets -Force | Out-Null
$taskPreviousOptions = $env:JAVA_TOOL_OPTIONS
$env:JAVA_TOOL_OPTIONS = "$taskPreviousOptions -Djdk.net.unixdomain.tmpdir=$($taskSockets.Replace('\','/'))".Trim()
try {
  & node (Join-Path $taskRoot 'node_modules/typescript/bin/tsc') --noEmit
  if ($LASTEXITCODE -ne 0) { throw 'mobile-typecheck-failed' }
  & node (Join-Path $taskRoot 'node_modules/vite/bin/vite.js') build (Join-Path $taskRoot 'apps/mobile')
  if ($LASTEXITCODE -ne 0) { throw 'mobile-web-build-failed' }
  & node (Join-Path $taskRoot 'scripts/mobile-cli.mjs') sync android
  if ($LASTEXITCODE -ne 0) { throw 'mobile-native-sync-failed' }
  Push-Location (Join-Path $taskRoot 'apps/mobile/android')
  try {
    & .\gradlew.bat assembleDebug --no-daemon --console=plain
    if ($LASTEXITCODE -ne 0) { throw 'mobile-android-build-failed' }
  } finally { Pop-Location }
  Get-FileHash -LiteralPath (Join-Path $taskRoot 'apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk') -Algorithm SHA256
} finally { $env:JAVA_TOOL_OPTIONS = $taskPreviousOptions }
