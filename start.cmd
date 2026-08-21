@echo off
setlocal

rem start.cmd -- Start/stop the Vite dev server
rem Usage: start.cmd [start^|stop^|restart^|status]  (default: start)

set ACTION=%1
if "%ACTION%"=="" set ACTION=start

set PORT=5173

if /i "%ACTION%"=="start"   goto :start
if /i "%ACTION%"=="stop"    goto :stop
if /i "%ACTION%"=="restart" goto :restart
if /i "%ACTION%"=="status"  goto :status

echo Usage: start.cmd [start^|stop^|restart^|status]
echo   start   Start the Vite dev server (default)
echo   stop    Stop the server
echo   restart Restart the server
echo   status  Show running status
exit /b 1

:start
call :find_pid
if defined VITE_PID (
    echo Server already running, PID=%VITE_PID%, port %PORT%
    exit /b 0
)
if not exist "node_modules\vite\bin\vite.js" (
    echo ERROR: node_modules\vite\bin\vite.js not found. Run "npm install" first.
    exit /b 1
)
echo Starting Vite dev server (http://127.0.0.1:%PORT%) ...
start "vite-dev-server" /MIN node node_modules\vite\bin\vite.js
echo Started in background (minimized window title: vite-dev-server)
echo Tip: run "start.cmd stop" to stop, or close that minimized window.
exit /b 0

:stop
call :find_pid
if not defined VITE_PID (
    echo Server is not running.
    exit /b 0
)
echo Stopping server process PID=%VITE_PID% ...
taskkill /PID %VITE_PID% /F >nul 2>&1
if errorlevel 1 (
    echo WARN: taskkill failed, trying by window title ...
    taskkill /FI "WINDOWTITLE eq vite-dev-server*" /F >nul 2>&1
)
timeout /t 1 /nobreak >nul
call :find_pid
if defined VITE_PID (
    echo ERROR: process still running (PID=%VITE_PID%). Kill it manually in Task Manager.
    exit /b 1
)
echo Stopped.
exit /b 0

:restart
call :stop
goto :start

:status
call :find_pid
if defined VITE_PID (
    echo Running: PID=%VITE_PID%, port %PORT%
    exit /b 0
) else (
    echo Not running.
    exit /b 1
)

:find_pid
set VITE_PID=
for /f "tokens=5" %%P in ('netstat -ano ^| findstr "LISTENING" ^| findstr ":%PORT% "') do (
    set VITE_PID=%%P
    goto :found
)
:found
goto :eof