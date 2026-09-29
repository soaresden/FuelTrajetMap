@echo off
cd /d "%~dp0"
start "" http://localhost:8080
python -m http.server 8080 2>nul || py -m http.server 8080 2>nul || npx --yes serve -l 8080 .
