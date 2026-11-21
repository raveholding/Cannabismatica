@echo off
rem Sistema VB ONG - Instala el agente del lector de huellas (VINCULAR BUSINESS - (387) 4484132)
rem Copia el agente a la carpeta del usuario y lo deja iniciando con Windows. No pide administrador.
cd /d "%~dp0"
set EXE=vbong-huellas.exe
if "%PROCESSOR_ARCHITECTURE%"=="x86" if not defined PROCESSOR_ARCHITEW6432 set EXE=vbong-huellas-32bits.exe
if not exist "%EXE%" (
  echo No encuentro %EXE% en esta carpeta. Descargalo del sistema: Perifericos - Lector de huellas.
  pause
  exit /b 1
)
start "" "%EXE%" -instalar
echo Listo. Si aparece un aviso de Windows SmartScreen, elegi "Mas informacion" y "Ejecutar de todas formas".
timeout /t 6 >nul
