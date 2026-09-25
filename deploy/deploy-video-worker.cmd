@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy-video-worker.ps1" %*
