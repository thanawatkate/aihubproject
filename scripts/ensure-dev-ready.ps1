# Create .env if missing, start local MySQL, npm install, run migrations.
# Usage: cd aihubproject; .\scripts\ensure-dev-ready.ps1
$ErrorActionPreference = "Stop"
$Root = Split-Path $PSScriptRoot -Parent
Set-Location $Root

$npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $npm) { $npm = Get-Command npm -ErrorAction SilentlyContinue }
if (-not $npm) {
    Write-Error "npm not found — install Node.js 18+"
}

function Set-EnvValue([string]$Key, [string]$Value) {
    $lines = Get-Content -LiteralPath ".env"
    $found = $false
    $out = foreach ($line in $lines) {
        if ($line.StartsWith("$Key=")) {
            $found = $true
            "$Key=$Value"
        } else {
            $line
        }
    }
    if (-not $found) { $out += "$Key=$Value" }
    Set-Content -LiteralPath ".env" -Value $out
}

$createdEnv = $false
if (-not (Test-Path ".env")) {
    if (-not (Test-Path ".env.example")) {
        Write-Error "Missing .env.example — cannot bootstrap AiHub env"
    }
    Write-Host "==> Creating .env from .env.example (dev defaults + generated secrets)"
    Copy-Item ".env.example" ".env"
    $createdEnv = $true
    $admin = (& node -e "console.log(require('crypto').randomBytes(32).toString('hex'))").Trim()
    $enc = (& node -e "console.log(require('crypto').randomBytes(32).toString('hex'))").Trim()
    Set-EnvValue "ADMIN_SECRET" $admin
    Set-EnvValue "ENCRYPTION_KEY" $enc
    Set-EnvValue "DB_HOST" "localhost"
    Set-EnvValue "DB_PORT" "3307"
    Set-EnvValue "DB_NAME" "aihub_db"
    Set-EnvValue "DB_USER" "aihub_user"
    Set-EnvValue "DB_PASSWORD" "aihub_pass"
    Set-EnvValue "CORS_ORIGINS" "http://localhost:5173,http://localhost:3000,http://localhost:3099,http://localhost:8501,http://127.0.0.1:8501,http://127.0.0.1:8000"
}

Get-Content ".env" | ForEach-Object {
    if ($_ -match '^\s*#' -or $_ -notmatch '=') { return }
    $pair = $_.Split('=', 2)
    Set-Item -Path "env:$($pair[0])" -Value $pair[1]
}

if (-not $env:ADMIN_SECRET -or $env:ADMIN_SECRET.Length -lt 32) {
    Write-Error "ADMIN_SECRET must be set (>=32 chars) in .env"
}
if (-not $env:ENCRYPTION_KEY -or $env:ENCRYPTION_KEY -notmatch '^[0-9a-fA-F]{64}$') {
    Write-Error "ENCRYPTION_KEY must be 64 hex chars in .env"
}

$dbHost = if ($env:DB_HOST) { $env:DB_HOST } else { "localhost" }
$dbPort = if ($env:DB_PORT) { $env:DB_PORT } else { "3306" }
$useComposeDb = ($dbHost -in @("localhost", "127.0.0.1")) -and ($dbPort -eq "3307")

if ($useComposeDb) {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        Write-Error "docker not found — needed for MySQL on ${dbHost}:${dbPort}"
    }
    Write-Host "==> Starting AiHub MySQL (host port $dbPort)..."
    docker compose up -d db
    Write-Host "==> Waiting for MySQL..."
    $up = $false
    for ($i = 1; $i -le 90; $i++) {
        docker compose exec -T db mysql "-u$($env:DB_USER)" "-p$($env:DB_PASSWORD)" "-D$($env:DB_NAME)" -N -e "SELECT 1" 2>$null
        if ($LASTEXITCODE -eq 0) {
            Write-Host "    mysql is ready"
            $up = $true
            break
        }
        Start-Sleep -Seconds 2
    }
    if (-not $up) {
        Write-Error "MySQL did not become healthy. Check: docker compose logs db"
    }
}

if (-not (Test-Path "node_modules")) {
    Write-Host "==> npm install..."
    & $npm.Source install
}

Write-Host "==> Migrating..."
$migrated = $false
for ($i = 1; $i -le 10; $i++) {
    & $npm.Source run migrate
    if ($LASTEXITCODE -eq 0) {
        $migrated = $true
        break
    }
    Write-Host "    migrate retry $i/10..."
    Start-Sleep -Seconds 3
}
if (-not $migrated) {
    Write-Error "migrate failed after retries"
}

if ($createdEnv) {
    Write-Host "==> Wrote $Root\.env (gitignored)"
}
