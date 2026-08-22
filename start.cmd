@echo off
setlocal

rem start.cmd -- Start/stop the Vite dev server / LAN server
rem Usage: start.cmd [start^|stop^|restart^|status^|server^|server-stop]  (default: start)

set ACTION=%1
if "%ACTION%"=="" set ACTION=start

set PORT=5173

if /i "%ACTION%"=="start"   goto :start
if /i "%ACTION%"=="stop"    goto :stop
if /i "%ACTION%"=="restart" goto :restart
if /i "%ACTION%"=="status"  goto :status
if /i "%ACTION%"=="server"  goto :server
if /i "%ACTION%"=="server-stop" goto :server-stop

echo Usage: start.cmd [start^|stop^|restart^|status^|server^|server-stop]
echo   start        Start the Vite dev server (default)
echo   stop         Stop the server
echo   restart      Restart the server
echo   status       Show running status
echo   server       Start the LAN multiplayer server (ws://0.0.0.0:3001/ws)
echo   server-stop  Stop the LAN server
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

:server
rem clear the inherited PORT=5173 from top of this script so the LAN server binds 3001, not 5173
set "PORT="
if not exist "server\node_modules\ws" (
    echo Installing LAN server dependencies ...
    pushd server
    call npm install
    popd
)
echo Starting LAN server (ws://0.0.0.0:3001/ws) ...
start "lan-server" /MIN node server\index.mjs
echo Started LAN server in background (window title: lan-server).
echo Stop with "start.cmd server-stop" or close that minimized window.
exit /b 0

:server-stop
taskkill /FI "WINDOWTITLE eq lan-server*" /F >nul 2>&1
echo LAN server stopped.
exit /b 0