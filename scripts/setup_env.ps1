Param(
    [switch]$Force
)

$ErrorActionPreference = "Stop"
$projectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$venv = Join-Path $projectRoot ".venv"
$requirements = Join-Path $projectRoot "requirements.txt"

$pythonCommands = @(
    @("py", "-3"),
    @("python"),
    @("python3")
)

$pythonCommand = $null
foreach ($candidate in $pythonCommands) {
    if (Get-Command $candidate[0] -ErrorAction SilentlyContinue) {
        $pythonCommand = $candidate
        break
    }
}

if ($null -eq $pythonCommand) {
    Write-Error "Python is not available. Install Python 3.11+ or add it to PATH."
    exit 1
}

if (Test-Path $venv -and -not $Force) {
    Write-Host ".venv already exists. Use -Force to recreate."
    exit 0
}

if (Test-Path $venv) {
    Remove-Item -Recurse -Force $venv
}

$pythonExe = $pythonCommand[0]
$pythonBaseArgs = @()
if ($pythonCommand.Length -gt 1) {
    $pythonBaseArgs = $pythonCommand[1..($pythonCommand.Length - 1)]
}

& $pythonExe @pythonBaseArgs -m venv $venv
& "$venv\Scripts\Activate.ps1"
python -m pip install --upgrade pip

if (Test-Path $requirements) {
    python -m pip install -r $requirements
}

Write-Host "Environment created and activated. To activate later: . .venv\Scripts\Activate.ps1"
