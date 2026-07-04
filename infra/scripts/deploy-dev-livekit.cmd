@echo off
setlocal

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy-dev-livekit.ps1" %*

exit /b %ERRORLEVEL%
