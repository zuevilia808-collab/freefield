@echo off
rem Freefield: update the program from GitHub (main) - double click. Same as pc/update.ps1.
powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/zuevilia808-collab/freefield/main/pc/update.ps1 | iex"
pause
