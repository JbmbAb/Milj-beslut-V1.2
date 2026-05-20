@echo off
setlocal enabledelayedexpansion

REM Set the directory
set "testDir=%~dp0"

REM Define files to keep
set "keepFiles=server.security.rateLimit.test.ts server.security.rateLimitDb.test.ts server.security.auditTrail.test.ts server.security.auditSanitization.test.ts server.security.projectAccess.test.ts server.repositories.projectAccessRepository.test.ts server.repositories.userRepository.test.ts server.repositories.requirementsRepository.test.ts server.services.completionService.test.ts server.services.bankIdService.test.ts"

REM Count initial files
setlocal disabledelayedexpansion
for /f %%A in ('dir /b "%testDir%*.test.ts" 2^>nul ^| find /c /v ""') do set initialCount=%%A
endlocal & set initialCount=%initialCount%

echo Initial .test.ts files: %initialCount%
echo.

REM Delete files not in the keep list
set deleteCount=0
for %%f in ("%testDir%*.test.ts") do (
    set fileName=%%~nf
    setlocal enabledelayedexpansion
    set "keep=0"
    for %%k in (%keepFiles%) do (
        if "!fileName!"=="%%k" set "keep=1"
    )
    if !keep! equ 0 (
        echo Deleting: !fileName!
        del /f "%%f"
        set /a deleteCount+=1
    )
    endlocal
)

echo.
echo Deleted %deleteCount% files
echo.

REM Count remaining files
for /f %%A in ('dir /b "%testDir%*.test.ts" 2^>nul ^| find /c /v ""') do set remainingCount=%%A

echo Remaining .test.ts files: %remainingCount%
echo.
echo Remaining files:
dir /b "%testDir%*.test.ts"
echo.
if %remainingCount% equ 10 (
    echo SUCCESS: All 10 required files remain
) else (
    echo ERROR: Expected 10 files, found %remainingCount%
)

endlocal
