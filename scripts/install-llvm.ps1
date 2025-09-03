$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

Write-Host 'Starting LLVM installation...'

# Parameters
$Version = '18.1.8'
$Url = "https://github.com/llvm/llvm-project/releases/download/llvmorg-$Version/LLVM-$Version-win64.exe"
$TempDir = 'C:\temp'
$Installer = Join-Path $TempDir 'llvm-installer.exe'

# Prepare temp directory
Write-Host 'Creating temp directory...'
New-Item -ItemType Directory -Path $TempDir -Force | Out-Null

# Download installer
Write-Host "Downloading LLVM installer $Version..."
Invoke-WebRequest -Uri $Url -OutFile $Installer -UseBasicParsing

# Verify download
Write-Host 'Verifying download...'
if (!(Test-Path $Installer)) { throw 'Download failed' }

# Silent install
Write-Host 'Installing LLVM silently...'
$process = Start-Process -FilePath $Installer -ArgumentList '/S', '/v/qn' -Wait -PassThru
if ($process.ExitCode -ne 0) { throw "Installation failed with exit code $($process.ExitCode)" }

# Cleanup
Write-Host 'Cleaning up installer...'
Remove-Item -Path $TempDir -Recurse -Force -ErrorAction SilentlyContinue

# Prepare workspace
Write-Host 'Creating workspace directory...'
New-Item -ItemType Directory -Path 'C:\work' -Force | Out-Null

# Verify
Write-Host 'Verifying Clang installation...'
& 'C:\Program Files\LLVM\bin\clang.exe' --version
Write-Host 'LLVM installation and setup completed successfully'
