@echo off
setlocal

title VSCode Dev

pushd %~dp0\..

:: Get electron, compile, built-in extensions
if "%VSCODE_SKIP_PRELAUNCH%"=="" (
	node build/lib/preLaunch.ts || (
		echo Failed to prepare VS Code for launch ^(build/lib/preLaunch.ts^). 1>&2
		exit /b 1
	)
)

set "NAMESHORT="
for /f "tokens=2 delims=:," %%a in ('findstr /R /C:"\"nameShort\":.*" product.json') do if not defined NAMESHORT set "NAMESHORT=%%~a"
set NAMESHORT=%NAMESHORT: "=%
set NAMESHORT=%NAMESHORT:"=%.exe
set CODE=".build\electron\%NAMESHORT%"

:: Manage built-in extensions
if "%~1"=="--builtin" goto builtin

:: Configuration
set NODE_ENV=development
set VSCODE_DEV=1
set VSCODE_CLI=1
set ELECTRON_ENABLE_LOGGING=1
set ELECTRON_ENABLE_STACK_DUMPING=1

set DISABLE_TEST_EXTENSION="--disable-extension=vscode.vscode-api-tests"
for %%A in (%*) do (
	if "%%~A"=="--extensionTestsPath" (
		set DISABLE_TEST_EXTENSION=""
	)
)

:: Open the repo root by default, but not when the caller passes folder/file paths.
setlocal EnableDelayedExpansion
set OPEN_FOLDER=.
set HAS_OPEN_TARGET=0
for %%A in (%*) do (
	set "ARG=%%~A"
	if not "!ARG:~0,1!"=="-" set HAS_OPEN_TARGET=1
)
if !HAS_OPEN_TARGET!==1 set OPEN_FOLDER=

:: Launch Code
%CODE% !OPEN_FOLDER! %DISABLE_TEST_EXTENSION% %*
endlocal
goto end

:builtin
%CODE% build/builtin

:end

popd

endlocal
