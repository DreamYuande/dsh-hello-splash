param(
    [Parameter(Mandatory)][string]$Compiler
)

$ErrorActionPreference = 'Stop'
$argsForBuild = @(
    '-std=c++20', '-D_WIN32_WINNT=0x0A00', '-Os', '-Wall', '-Wextra',
    '-municode', '-mwindows', '-static', '-s', '-ffunction-sections',
    '-fdata-sections', '-Wl,--gc-sections', '-I', (Join-Path $PSScriptRoot 'native\vendor'),
    (Join-Path $PSScriptRoot 'native\main.cpp'), (Join-Path $PSScriptRoot 'native\install.cpp'),
    (Join-Path $PSScriptRoot 'native\vector-scene.cpp'),
    '-o', (Join-Path $PSScriptRoot 'DSHNextWelcome.exe'),
    '-ld2d1', '-ldwrite', '-lole32', '-luuid', '-ldwmapi', '-lshell32'
)
& $Compiler @argsForBuild
if ($LASTEXITCODE) { throw "Native launcher build failed with exit code $LASTEXITCODE" }

