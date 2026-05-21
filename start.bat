@echo off
title Auto Deploy
cd /d "%~dp0"
echo Starting Auto Deploy...
npx electron .
pause
