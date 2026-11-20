param(
    [Parameter(Mandatory)][string]$Compiler
)

$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
Push-Location -LiteralPath $root
try {
    $metadata=Get-Content -LiteralPath package.json -Raw | ConvertFrom-Json
    $version=$metadata.version
    $output=Join-Path $root '.release'
    [void][IO.Directory]::CreateDirectory($output)

    node dev/export-native-geometry.mjs
    if ($LASTEXITCODE) { throw 'Could not export native geometry.' }
    node build.mjs
    if ($LASTEXITCODE) { throw 'Could not build the client.' }
    pnpm run check
    if ($LASTEXITCODE) { throw 'Client or host syntax check failed.' }
    & ./launcher/build-native.ps1 -Compiler $Compiler
    pnpm pack --pack-destination $output
    if ($LASTEXITCODE) { throw 'Could not pack the plugin.' }

    $package=Join-Path $output "dsh-hello-splash-$version.tgz"
    $zip=Join-Path $output "DSH-Next-Welcome-$version-Windows-x64.zip"
    $files=@($package, 'launcher/DSHNextWelcome.exe', 'scripts/安装.cmd', 'scripts/安装说明.txt')
    Compress-Archive -LiteralPath $files -DestinationPath $zip -Force
    Get-Item -LiteralPath $zip | Select-Object FullName,Length
} finally {
    Pop-Location
}
