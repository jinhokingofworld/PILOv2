@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0set-dev-external-secrets.ps1" %*
