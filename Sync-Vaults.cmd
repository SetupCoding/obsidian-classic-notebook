@echo off
chcp 65001 >nul
node "%~dp0scripts\sync-vaults.cjs" sync %*
set "NOTEBOOK_SYNC_EXIT=%ERRORLEVEL%"
echo.
pause
exit /b %NOTEBOOK_SYNC_EXIT%
