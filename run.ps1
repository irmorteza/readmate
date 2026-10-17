<#
.SYNOPSIS
  Runs WortTap locally: backend dev server + Vite dev server. Ctrl+C stops both.

.EXAMPLE
  .\run.ps1                      # real Textract (uses your AWS credentials), token "dev"
  .\run.ps1 -Engine fake         # recorded fixture, no AWS calls
  .\run.ps1 -Token my-secret     # token the app must send (type the same into the app)
#>
param(
  [ValidateSet("textract", "fake")][string]$Engine = "textract",
  [string]$Token = "dev",
  [int]$ApiPort = 8765,   # 3000 is blocked on some Windows machines
  [int]$WebPort = 5173,   # the dev server's CORS only allows http://localhost:5173
  [switch]$NoBrowser      # don't open the app in your default browser
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$python = Join-Path $root "backend\.venv\Scripts\python.exe"
if (-not (Test-Path $python)) {
  throw "Missing backend venv. Run: python -m venv backend\.venv; backend\.venv\Scripts\pip install -r backend\requirements-dev.txt"
}
if (-not (Test-Path (Join-Path $root "frontend\node_modules"))) {
  Write-Host "Installing frontend dependencies..."
  Push-Location (Join-Path $root "frontend"); npm install; Pop-Location
}

foreach ($port in $ApiPort, $WebPort) {
  if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
    throw "Port $port is already in use. Stop whatever is using it (or pick another with -ApiPort / -WebPort)."
  }
}

$env:OCR_ENGINE = $Engine
$env:PILOT_TOKEN = $Token
$env:DEV_PORT = "$ApiPort"
$env:VITE_API_URL = "http://localhost:$ApiPort"   # overrides frontend/.env.development

Write-Host "Backend : http://localhost:$ApiPort  (OCR_ENGINE=$Engine)"
Write-Host "App     : http://localhost:$WebPort"
Write-Host "Token   : $Token   <- paste this into the app"
if ($Engine -eq "textract") { Write-Host "Every photo is sent to Amazon Textract with your AWS credentials." }

$api = Start-Process -FilePath $python -ArgumentList "dev_server.py" `
  -WorkingDirectory (Join-Path $root "backend") -NoNewWindow -PassThru
try {
  Push-Location (Join-Path $root "frontend")
  $viteArgs = @("--port", $WebPort, "--strictPort")
  if (-not $NoBrowser) { $viteArgs += "--open" }
  npm run dev -- @viteArgs
} finally {
  Pop-Location
  if ($api -and -not $api.HasExited) { Stop-Process -Id $api.Id -Force }
  Write-Host "Stopped."
}
