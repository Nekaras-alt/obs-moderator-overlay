@echo off
REM ============================================================
REM  OBS Moderator Overlay - one-click launcher
REM ============================================================
REM  First run: installs npm deps, builds the client, starts server.
REM  After that: just starts the server (rebuilds if dist/ is missing).
REM  The server prints the moderator PIN and the OBS Browser Source URL.
REM ============================================================
setlocal
cd /d "%~dp0"

REM Install devDependencies too. Some systems ship with NODE_ENV=production,
REM which makes `npm install` skip the build tooling (vite, vue, ...). Force
REM dev deps by installing with --include=dev and clearing NODE_ENV here.
set "NODE_ENV="

if not exist "node_modules" (
  echo [setup] Installing dependencies ^(first run only^)...
  call npm install --include=dev
  if errorlevel 1 ( echo [error] npm install failed. & pause & exit /b 1 )
  REM esbuild (vite's bundler) ships a postinstall that fetches its binary.
  REM If your npm config blocks install scripts, approve esbuild explicitly:
  call npm approve-scripts esbuild >nul 2>&1
)

if not exist "dist" (
  echo [setup] Building client ^(first run^)...
  call npm run build
  if errorlevel 1 ( echo [error] build failed. & pause & exit /b 1 )
)

echo [run] Starting server on http://localhost:8090 ...
start "" http://localhost:8090/
node server\index.js
endlocal
