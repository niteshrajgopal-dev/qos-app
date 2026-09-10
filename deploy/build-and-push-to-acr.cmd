@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0build-and-push-to-acr.ps1" %*
