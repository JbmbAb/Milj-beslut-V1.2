@echo off
setlocal

set "SCRIPT_PS=%~dp0Run-OutlookTriageAction.ps1"

echo [1/2] Bygger actionable-lista (ingen flytt i Outlook)...
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_PS%"

echo.
echo [2/2] Om du vill flytta mejlen till samma Outlook-mapp direkt:
echo powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_PS%" -ApplyMove
echo.
pause

