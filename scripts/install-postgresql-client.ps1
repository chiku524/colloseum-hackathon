#Requires -Version 5.1
<#
.SYNOPSIS
  Installs PostgreSQL client tools (psql, pg_dump, etc.) machine-wide on Windows.

.DESCRIPTION
  Uses Chocolatey package "psql" (client binaries only — not the full server stack).
  Must run in an elevated PowerShell ("Run as administrator").

  After install, open a new terminal and run: psql --version

.EXAMPLE
  Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned -Force
  cd C:\path\to\web3stronghold
  .\scripts\install-postgresql-client.ps1
#>

$ErrorActionPreference = 'Stop'

function Test-Administrator {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  $p = New-Object Security.Principal.WindowsPrincipal($id)
  return $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-Administrator)) {
  Write-Host "This script must run as Administrator (Chocolatey installs under Program Files)." -ForegroundColor Yellow
  Write-Host "Right-click PowerShell -> Run as administrator, then:" -ForegroundColor Yellow
  Write-Host "  cd $PSScriptRoot\.." -ForegroundColor Cyan
  Write-Host "  .\scripts\install-postgresql-client.ps1" -ForegroundColor Cyan
  exit 1
}

if (-not (Get-Command choco -ErrorAction SilentlyContinue)) {
  Write-Host "Chocolatey not found. Install from https://chocolatey.org/install" -ForegroundColor Red
  exit 1
}

Write-Host "Installing Chocolatey package: psql (PostgreSQL CLI client)..." -ForegroundColor Green
choco install psql -y --no-progress

Write-Host ""
Write-Host "Done. Close and reopen your terminal, then run: psql --version" -ForegroundColor Green
