@echo off
set "ROOT=%~dp0"
set "STT_DIR=C:\Users\Larri\Documents\PRGRAMACAO\stt\openya"
set "STT_OUT=%ROOT%runtime\external-stt.txt"

if not exist "%ROOT%runtime" mkdir "%ROOT%runtime"
break > "%STT_OUT%"

cd /d "%STT_DIR%"
python stt-config-ok.py --output "%STT_OUT%" --no-meter
pause
