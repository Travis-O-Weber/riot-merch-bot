@echo off
echo ==========================================
echo   RIOT MERCH BOT - Chrome Launcher
echo ==========================================
echo.
echo Closing all Chrome windows...
taskkill /F /IM chrome.exe >nul 2>&1
timeout /t 3 /nobreak >nul
echo Done!
echo.
echo Launching Chrome with Remote Debugging on port 9222...
echo.
"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="C:\temp\chrome-debug-profile" https://merch.riotgames.com
echo.
echo ==========================================
echo   Chrome closed. Press any key to exit.
echo ==========================================
pause >nul
