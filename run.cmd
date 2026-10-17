@echo off
rem Wrapper for run.ps1 that works when PowerShell blocks script files.
rem The bypass applies to this one process only; the system execution policy is not changed.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run.ps1" %*
