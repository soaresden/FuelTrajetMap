@echo off
rem Reconstruit l AAB release (Play Store, signe avec la cle d upload). Plus d APK : l appli passe par le Store.
rem Prerequis : Node.js, SDK Android (platform 36), JDK 21, apk\android\keystore\keystore.properties (hors git).
rem Avant : incrementer versionCode + versionName (apk\android\app\build.gradle), version (js\config.js), cache (sw.js).
cd /d "%~dp0"
if not defined ANDROID_HOME if exist C:\Android\sdk set ANDROID_HOME=C:\Android\sdk
if exist C:\Android\jdk-21 set JAVA_HOME=C:\Android\jdk-21
if not exist ..\data\fr.json echo (info) data\ absent : lance d abord "node tools\build-data.mjs" a la racine.
if not exist node_modules call npm install
if exist www rmdir /s /q www
mkdir www
for %%d in (css js icons vendor data) do xcopy /e /i /q /y "..\%%d" "www\%%d" >nul
for %%f in (index.html manifest.webmanifest privacy.html version-min.json sw.js) do copy /y "..\%%f" www\ >nul
call npx cap sync android
cd android
call gradlew.bat bundleRelease
echo.
echo AAB Play : %cd%\app\build\outputs\bundle\release\app-release.aab
pause
