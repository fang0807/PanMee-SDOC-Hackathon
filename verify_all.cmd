@echo off
cd /d "%~dp0"
python verify_all.py %*
pause
