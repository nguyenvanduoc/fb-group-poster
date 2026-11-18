@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo === Cai dat lan dau (chi chay 1 lan) ===
python -m venv .venv || (echo Chua cai Python. Tai tai https://www.python.org/downloads/ va tick "Add python.exe to PATH" & pause & exit /b 1)
call .venv\Scripts\activate.bat
python -m pip install --upgrade pip
pip install -r requirements.txt
python -m playwright install chromium
echo.
echo === Cai dat xong. Chay start.bat de mo tool ===
pause
