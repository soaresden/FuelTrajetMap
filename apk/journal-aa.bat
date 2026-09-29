@echo off
rem Journal Android Auto de FuelMap : lance ce script, ouvre FuelMap dans le DHU, puis appuie sur une touche.
cd /d "%~dp0"
adb logcat -c
echo Ouvre FuelMap dans le DHU, attends l ecran, puis appuie sur une touche...
pause >nul
adb logcat -d -s FuelMapCar chromium AndroidRuntime CarApp.H CAR.VALIDATOR > aa-log.txt
echo Journal ecrit dans apk\aa-log.txt.
pause
