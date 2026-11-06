$ErrorActionPreference = 'Stop'
$bridgeDirectory = $PSScriptRoot
$nodeExecutable = (Get-Command node -ErrorAction Stop).Source
New-Item -ItemType Directory -Force -Path (Join-Path $bridgeDirectory '.local') | Out-Null
try {
    $existing = Invoke-RestMethod 'http://127.0.0.1:27153/health' -TimeoutSec 2
    Write-Output 'A bridge service is already listening on port 27153.'
    exit 0
} catch {}
$bridgeProcess = Start-Process -FilePath $nodeExecutable -ArgumentList 'server.mjs' -WorkingDirectory $bridgeDirectory -WindowStyle Hidden -RedirectStandardOutput (Join-Path $bridgeDirectory '.local/server.log') -RedirectStandardError (Join-Path $bridgeDirectory '.local/server-error.log') -PassThru
$bridgeProcess.Id | Set-Content -LiteralPath (Join-Path $bridgeDirectory '.local/server.pid')
Write-Output "Started local bridge (PID $($bridgeProcess.Id)). Connect Bitburner Remote API, then run npm run install-game."
