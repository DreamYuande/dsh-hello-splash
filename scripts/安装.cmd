@echo off
setlocal
if not exist "%~dp0DSHNextWelcome.exe" (
  echo Extract all files before installing.
  pause
  exit /b 1
)
start "" /wait "%~dp0DSHNextWelcome.exe" --install %*
exit /b %errorlevel%
