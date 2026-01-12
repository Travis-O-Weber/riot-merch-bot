@echo off
echo ==========================================
echo   STEP 1: Launch Chrome for Bot
echo ==========================================
echo.
echo Closing all Chrome windows...
taskkill /F /IM chrome.exe >nul 2>&1
timeout /t 3 /nobreak >nul
echo Done!
echo.
echo Launching Chrome with debugging enabled...
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="%TEMP%\chrome-bot-profile" https://merch.riotgames.com
echo.
echo ==========================================
echo   Chrome is open!
echo.
echo   NOW:
echo   1. Sign in to your Riot account
echo   2. Run "2-start-bot.bat" to start the bot
echo ==========================================
echo.
pause
