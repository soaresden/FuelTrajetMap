@echo off
rem Reconstruit l APK release (signe avec la cle d upload : s installe par-dessus la version en place) et l AAB (Play Store).
rem Prerequis : Node.js, SDK Android (platform 36), JDK 21, apk\android\keystore\keystore.properties (hors git).
rem Avant : incrementer versionCode + versionName (apk\android\app\build.gradle), version (js\config.js), cache (sw.js).
cd /d "%~dp0"
if not exist ..\data\fr.json echo (info) data\ absent : lance d abord "node tools\build-data.mjs" a la racine.
if not exist node_modules call npm install
if exist www rmdir /s /q www
mkdir www
for %%d in (css js icons vendor data) do xcopy /e /i /q /y "..\%%d" "www\%%d" >nul
for %%f in (index.html manifest.webmanifest privacy.html version-min.json sw.js) do copy /y "..\%%f" www\ >nul
call npx cap sync android
cd android
call gradlew.bat assembleRelease bundleRelease
echo.
echo APK release : %cd%\app\build\outputs\apk\release\app-release.apk   (adb install -r ...)
echo AAB Play    : %cd%\app\build\outputs\bundle\release\app-release.aab
pause
