@echo off
setlocal
cd /d "%~dp0"

set "NODE=C:\Users\dlwlrma\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
if not exist "%NODE%" set "NODE=node"

echo =============================================
echo   COC Base Database - starting server
echo =============================================
echo Node: %NODE%
echo Opening http://localhost:8899 ...
echo Close this window or press Ctrl+C to stop
echo.

start "" "http://localhost:8899"
"%NODE%" server.js

echo.
echo Server stopped.
pause