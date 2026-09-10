@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy-to-acr.ps1" %*
