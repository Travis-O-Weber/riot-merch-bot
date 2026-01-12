@echo off
echo ==========================================
echo   STEP 2: Start the Bot
echo ==========================================
echo.
echo Make sure you:
echo   - Ran "1-launch-chrome.bat" first
echo   - Signed into your Riot account
echo.
echo Type 00 to start the bot:
:waitloop
set /p confirm=">> "
if "%confirm%"=="00" goto startbot
echo Invalid. Type 00 and press Enter.
goto waitloop

:startbot
echo.
echo Starting bot...
echo.
cd /d "E:\my-coding-projects\riot-merch-bot"
npm start
echo.
echo ==========================================
echo   Bot finished!
echo ==========================================
pause
