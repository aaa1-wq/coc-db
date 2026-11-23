@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo   COC Auto Screenshot Helper
echo ============================================
python auto-shot.py %*
pause