param(
  [Parameter(Mandatory = $true)]
  [string]$Installer,
  [Parameter(Mandatory = $true)]
  [string]$ProductCode,
  [Parameter(Mandatory = $true)]
  [string]$Version
)

$ErrorActionPreference = 'Stop'
$Installer = [System.IO.Path]::GetFullPath($Installer)

function Normalize-DirectoryPath {
  param([string]$Path)

  return [System.IO.Path]::TrimEndingDirectorySeparator($Path)
}

$installDir = Normalize-DirectoryPath (Join-Path $env:ProgramFiles 'OneWorks')

function Invoke-MsiExec {
  param([string[]]$Arguments)

  $process = Start-Process -FilePath 'msiexec.exe' -ArgumentList $Arguments -PassThru -Wait
  if ($process.ExitCode -ne 0) {
    throw "msiexec $Arguments failed with exit code $($process.ExitCode)."
  }
}

function Get-MachinePathSegments {
  return @(
    [Environment]::GetEnvironmentVariable('PATH', 'Machine').Split(';') |
      Where-Object { $_ } |
      ForEach-Object { Normalize-DirectoryPath $_ }
  )
}

$installed = $false
try {
  Invoke-MsiExec -Arguments @('/i', $Installer, '/qn', '/norestart')
  $installed = $true

  foreach ($name in @('oneworks.cmd', 'ow.cmd', 'owo.cmd', 'README.txt')) {
    if (-not (Test-Path (Join-Path $installDir $name))) {
      throw "Expected installed payload is missing: $name"
    }
  }
  if (-not (Get-MachinePathSegments | Where-Object { $_ -ieq $installDir })) {
    throw "Machine PATH does not contain $installDir after install."
  }

  $verifyScript = Join-Path $env:RUNNER_TEMP 'verify-oneworks-msi.ps1'
  @"
`$env:PATH = [Environment]::GetEnvironmentVariable('PATH', 'Machine') + ';' + `$env:PATH
& '$installDir\oneworks.cmd' --version
if (`$LASTEXITCODE -ne 0) { exit `$LASTEXITCODE }
"@ | Set-Content -Path $verifyScript -NoNewline
  $versionOutput = & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $verifyScript
  if ($LASTEXITCODE -ne 0 -or $versionOutput -notmatch [regex]::Escape($Version)) {
    throw "Installed oneworks.cmd did not report $Version. Output: $versionOutput"
  }
}
finally {
  if ($installed) {
    Invoke-MsiExec -Arguments @('/x', $ProductCode, '/qn', '/norestart')
  }
}

if (Test-Path $installDir) {
  throw "Install directory remains after uninstall: $installDir"
}
if (Get-MachinePathSegments | Where-Object { $_ -ieq $installDir }) {
  throw "Machine PATH still contains $installDir after uninstall."
}
