#!/usr/bin/env pwsh
<#
.SYNOPSIS
  Generates a local CA and a server certificate for the validation TLS proxy.

.DESCRIPTION
  The phone app refuses plain HTTP, so the local portal has to be reachable over
  TLS. This mints a throwaway CA and a certificate whose SAN covers 10.0.2.2 —
  the address the Android emulator uses for the host — then installs the CA into
  the emulator's system trust store.

  Android 14 keeps the trusted roots in the Conscrypt APEX, which is read-only.
  The store is replaced with a tmpfs copy that also contains our CA, and the
  same mount is entered into every running app namespace. It lives only until
  the emulator restarts, which is exactly the lifetime we want.

  Everything it writes lands in tests/e2e/local-stack/certs, which .gitignore
  excludes.

.EXAMPLE
  pwsh tests/e2e/local-stack/make-certs.ps1
#>

$ErrorActionPreference = 'Stop'
# 'Stop' alone ignores native exit codes, so a failed openssl call would leave a
# stale or partial certificate in place and still reach the success message.
$PSNativeCommandUseErrorActionPreference = $true

$here = $PSScriptRoot
$certDir = Join-Path $here 'certs'
$openssl = (Get-Command openssl -ErrorAction SilentlyContinue).Source
if (-not $openssl) { $openssl = 'C:\Program Files\Git\usr\bin\openssl.exe' }

New-Item -ItemType Directory -Force -Path $certDir | Out-Null

$extPath = Join-Path $certDir 'server.ext'
@'
subjectAltName = IP:10.0.2.2, IP:127.0.0.1, DNS:localhost
basicConstraints = CA:FALSE
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
'@ | Set-Content -Path $extPath -Encoding ascii

Push-Location $certDir
try {
  # The extensions are stated rather than inherited: req -x509 otherwise takes
  # them from the host openssl.cnf, and the openssl picked up above is whichever
  # one is on PATH, so a host with a leaner config could mint a root that is not
  # a usable trust anchor.
  & $openssl req -x509 -newkey rsa:2048 -sha256 -days 30 -nodes `
    -keyout ca.key -out ca.crt -subj '/CN=Bank Importer Local Validation CA' `
    -addext 'basicConstraints=critical,CA:TRUE' `
    -addext 'keyUsage=critical,keyCertSign,cRLSign' 2>&1 | Out-Null

  & $openssl req -newkey rsa:2048 -nodes -keyout server.key -out server.csr `
    -subj '/CN=10.0.2.2' 2>&1 | Out-Null

  & $openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial `
    -out server.crt -days 30 -sha256 -extfile server.ext 2>&1 | Out-Null

  # Android looks the root up by the hash of its subject, named <hash>.0.
  $hash = (& $openssl x509 -subject_hash_old -in ca.crt -noout).Trim()
  Copy-Item ca.crt "$hash.0" -Force
  Write-Host "CA installed under Android hash name: $hash.0"
}
finally { Pop-Location }

Write-Host "Certificates written to $certDir"
