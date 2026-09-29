@echo off
rem Reconstruit l APK (debug, a sideloader) et l AAB (release, Play Store) a partir du dossier parent.
rem Prerequis : Node.js, Android Studio ou SDK Android (platform 36, JDK 21).
cd /d "%~dp0"
if not exist ..\data\fr.json echo (info) data\ absent : lance d abord "node tools\build-data.mjs" a la racine.
if not exist node_modules call npm install
if exist www rmdir /s /q www
mkdir www
for %%d in (css js icons vendor data) do xcopy /e /i /q /y "..\%%d" "www\%%d" >nul
copy /y ..\index.html www\ >nul
copy /y ..\manifest.webmanifest www\ >nul
call npx cap sync android
cd android
call gradlew.bat assembleDebug bundleRelease
echo.
echo APK debug : %cd%\app\build\outputs\apk\debug\app-debug.apk
echo AAB Play  : %cd%\app\build\outputs\bundle\release\app-release.aab
pause
