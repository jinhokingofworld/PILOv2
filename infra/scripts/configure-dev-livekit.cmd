@echo off
setlocal

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0configure-dev-livekit.ps1" %*

exit /b %ERRORLEVEL%
