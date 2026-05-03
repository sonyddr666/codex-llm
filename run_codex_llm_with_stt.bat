@echo off
cd /d "%~dp0"
start "STT Python" /min "%~dp0run_stt_sidecar.bat"
npm start
pause
