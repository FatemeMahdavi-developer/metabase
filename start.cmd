@echo off
set "PATH=%~dp0.tools\php;%~dp0.tools\node;%PATH%"
cd /d "%~dp0app"
"%~dp0.tools\php\php.exe" artisan serve --host=127.0.0.1 --port=8000