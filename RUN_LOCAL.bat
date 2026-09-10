@echo off
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js नहीं मिला. पहले Node.js install करें.&pause&exit /b 1)
if not exist node_modules (echo पहली बार packages install हो रहे हैं...&npm install)
start "FeeSetu" http://127.0.0.1:3000
node server.js
