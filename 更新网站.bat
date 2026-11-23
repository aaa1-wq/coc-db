@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ============================================
echo   COC Base DB - One-Click Update
echo ============================================
echo.

echo [1/3] Rebuilding single-ios.html ...
python build-single.py
if errorlevel 1 (
  echo [ERROR] build-single.py failed.
  pause
  exit /b 1
)
echo.

echo [2/3] Committing to git ...
git add -A
git -c user.name="aaa1-wq" -c user.email="aaa1-wq@users.noreply.github.com" commit -m "update %date% %time%"
echo.

echo [3/3] Pushing to GitHub ...
git push origin main
if errorlevel 1 (
  echo [ERROR] push failed - token expired or network issue.
  echo Fix: git remote set-url origin https://NEWTOKEN@github.com/aaa1-wq/coc-db.git
  pause
  exit /b 1
)

echo.
echo ============================================
echo   Done! Cloudflare Pages auto-updates in ~1 min.
echo   Site: https://coc-db.pages.dev/single-ios.html
echo ============================================
pause