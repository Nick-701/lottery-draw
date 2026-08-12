@echo off
title 抽奖系统 - 请勿关闭此窗口
cd /d E:\Nick\lottery
echo.
echo =====================================
echo    🎰 抽奖系统启动中...
echo =====================================
echo.
echo [1/2] 启动本地服务器...
start "LotteryServer" /MIN node server.js
timeout /t 3 /nobreak > nul
echo         服务器已启动 √
echo.
echo [2/2] 生成公网链接...
echo         请稍候...
echo.
npx localtunnel --port 3000
pause
