param(
    [string]$GeminiApiKey,
    [string]$DbPassword,
    [string]$AppSecretKey,
    [string]$KeyVaultName = "creativeanchor-kv",
    [string]$DbName       = "postgres",
    [string]$DbUser       = "supabase",
    [string]$DbHost       = "supabase-postgres.supabase.svc.cluster.local"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ─── Helpers ─────────────────────────────────────────────────────────────────

function Set-KvSecret {
    param([string]$Name, [string]$Value)
    Write-Host "  Setting secret: $Name ..." -ForegroundColor Cyan
    az keyvault secret set --vault-name $KeyVaultName --name $Name --value $Value --output none
    if ($LASTEXITCODE -ne 0) { throw "Failed to set secret: $Name" }
    Write-Host "  OK $Name" -ForegroundColor Green
}

function New-RandomSecret {
    param([int]$Length = 40)
    $chars  = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
    $rng    = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $bytes  = New-Object byte[] $Length
    $rng.GetBytes($bytes)
    $result = -join ($bytes | ForEach-Object { $chars[$_ % $chars.Length] })
    return $result
}

# ─── Prompt for missing params ────────────────────────────────────────────────

if (-not $GeminiApiKey) {
    $GeminiApiKey = Read-Host "Enter your Google Gemini API key (GOOGLE_API_KEY)"
}
if (-not $DbPassword) {
    $DbPassword = Read-Host "Enter a strong Postgres password for the supabase user"
}
if (-not $AppSecretKey) {
    $AppSecretKey = New-RandomSecret -Length 48
    Write-Host "[Auto-generated] APP_SECRET_KEY: $AppSecretKey" -ForegroundColor Yellow
}

# ─── Derived values ───────────────────────────────────────────────────────────

$SupabaseUrl  = "http://supabase-kong.supabase.svc.cluster.local"
$DbUrlDefault = "postgresql://${DbUser}:${DbPassword}@${DbHost}:5432/${DbName}"

$JwtSecret = New-RandomSecret -Length 40
Write-Host "[Auto-generated] JWT_SECRET: $JwtSecret" -ForegroundColor Yellow

# ─── Pure-PowerShell HS256 JWT generator ─────────────────────────────────────

function New-SupabaseJwt {
    param([string]$Role, [string]$Secret)

    $header  = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes('{"alg":"HS256","typ":"JWT"}')) `
                   -replace '\+','-' -replace '/','_' -replace '='
    $now     = [int][double]::Parse((Get-Date -UFormat %s))
    $exp     = $now + 315360000
    $payloadJson = "{`"role`":`"$Role`",`"iss`":`"supabase`",`"iat`":$now,`"exp`":$exp}"
    $payload = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($payloadJson)) `
                   -replace '\+','-' -replace '/','_' -replace '='

    $sigInput = "$header.$payload"
    $key      = [System.Text.Encoding]::UTF8.GetBytes($Secret)
    $data     = [System.Text.Encoding]::UTF8.GetBytes($sigInput)
    $hmac     = New-Object System.Security.Cryptography.HMACSHA256
    $hmac.Key = $key
    $sig      = [Convert]::ToBase64String($hmac.ComputeHash($data)) `
                    -replace '\+','-' -replace '/','_' -replace '='

    return "$sigInput.$sig"
}

Write-Host "`nGenerating Supabase JWT keys (pure PowerShell)..." -ForegroundColor Cyan

$AnonKey        = New-SupabaseJwt -Role "anon"         -Secret $JwtSecret
$ServiceRoleKey = New-SupabaseJwt -Role "service_role" -Secret $JwtSecret

Write-Host "[Generated] anon-key:         $($AnonKey.Substring(0,30))..." -ForegroundColor Yellow
Write-Host "[Generated] service-role-key: $($ServiceRoleKey.Substring(0,30))..." -ForegroundColor Yellow

$SupabaseKey = $ServiceRoleKey

# ─── Get Tenant ID & patch Kustomize overlay ─────────────────────────────────

Write-Host "`nFetching Azure Tenant ID..." -ForegroundColor Cyan
$TenantId = az account show --query tenantId -o tsv
Write-Host "  Tenant ID: $TenantId" -ForegroundColor Green

$SecretstorePatchPath = Join-Path $PSScriptRoot "..\..\gitops\services\overlays\prod\secretstore-patch.yaml"
$SecretstorePatchPath = [System.IO.Path]::GetFullPath($SecretstorePatchPath)

if (Test-Path $SecretstorePatchPath) {
    $lines = @(
        "apiVersion: external-secrets.io/v1beta1",
        "kind: ClusterSecretStore",
        "metadata:",
        "  name: azure-kv",
        "spec:",
        "  provider:",
        "    azurekv:",
        "      tenantId: $TenantId"
    )
    Set-Content -Path $SecretstorePatchPath -Value $lines -Encoding utf8
    Write-Host "  Patched secretstore-patch.yaml with Tenant ID" -ForegroundColor Green
} else {
    Write-Warning "Could not find secretstore-patch.yaml at: $SecretstorePatchPath"
    Write-Host "  Manually set tenantId: $TenantId in gitops/services/overlays/prod/secretstore-patch.yaml"
}

# ─── Populate Key Vault ───────────────────────────────────────────────────────

Write-Host "`n=== Populating Key Vault: $KeyVaultName ===" -ForegroundColor Magenta

Write-Host "`n--- Backend App Secrets ---" -ForegroundColor White
Set-KvSecret -Name "supabase-url"   -Value $SupabaseUrl
Set-KvSecret -Name "supabase-key"   -Value $SupabaseKey
Set-KvSecret -Name "gemini-api-key" -Value $GeminiApiKey
Set-KvSecret -Name "app-secret-key" -Value $AppSecretKey

Write-Host "`n--- Supabase Stack Secrets ---" -ForegroundColor White
Set-KvSecret -Name "supabase-db-name"          -Value $DbName
Set-KvSecret -Name "supabase-db-user"          -Value $DbUser
Set-KvSecret -Name "supabase-db-password"      -Value $DbPassword
Set-KvSecret -Name "supabase-db-url"           -Value $DbUrlDefault
Set-KvSecret -Name "supabase-jwt-secret"       -Value $JwtSecret
Set-KvSecret -Name "supabase-anon-key"         -Value $AnonKey
Set-KvSecret -Name "supabase-service-role-key" -Value $ServiceRoleKey

# ─── Summary ─────────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "=====================================================" -ForegroundColor Green
Write-Host " All secrets populated in Key Vault: $KeyVaultName"    -ForegroundColor Green
Write-Host "=====================================================" -ForegroundColor Green
Write-Host ""
Write-Host "NEXT STEPS:" -ForegroundColor Cyan
Write-Host "  1. Commit & push gitops changes:"
Write-Host "       git add gitops/ && git commit -m 'fix: prod overlay tenant ID' && git push"
Write-Host "  2. Verify ClusterSecretStore:"
Write-Host "       kubectl get clustersecretstore azure-kv"
Write-Host "  3. Check ExternalSecrets synced:"
Write-Host "       kubectl get externalsecret -A"
Write-Host "  4. Confirm cluster secrets:"
Write-Host "       kubectl get secret app-secrets -o yaml"
Write-Host "       kubectl get secret supabase-secrets -n supabase -o yaml"
Write-Host "  5. Check pods are running:"
Write-Host "       kubectl get pods -A"
Write-Host "  6. Hit the public IP:"
Write-Host "       curl http://<STATIC_IP>/healthz"
