@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 22 or newer first: https://nodejs.org/
  if not "%KEEPANY_PREVIEW_NO_PAUSE%"=="1" pause
  exit /b 1
)
node .\preview-server.mjs start %*
set "KEEPANY_EXIT=%ERRORLEVEL%"
if not "%KEEPANY_EXIT%"=="0" if not "%KEEPANY_PREVIEW_NO_PAUSE%"=="1" pause
exit /b %KEEPANY_EXIT%
