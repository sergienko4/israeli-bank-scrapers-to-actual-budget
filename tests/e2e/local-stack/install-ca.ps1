#!/usr/bin/env pwsh
<#
.SYNOPSIS
  Installs the local validation CA into a running emulator's system trust store.

.DESCRIPTION
  The app trusts system roots only — it ships no network security config that
  would opt into user-installed certificates, which is the right default and not
  something a test should change in the app.

  Android 14 serves its roots from the read-only Conscrypt APEX. This stages a
  copy of that store plus our CA under /data/local/tmp and bind-mounts it over
  the APEX path, first in init's mount namespace and then in zygote's, so every
  app forked afterwards inherits the patched store. The mount is tmpfs-backed
  and disappears on emulator restart.

  Re-running against an already-patched emulator is safe: staging is skipped
  and only the force-stops repeat.

  Chrome and the app are force-stopped at the end so both re-fork from the
  patched zygote. Without that they keep the store they started with and the
  sign-in page fails with ERR_CERT_AUTHORITY_INVALID.

.EXAMPLE
  pwsh tests/e2e/local-stack/install-ca.ps1
#>

$ErrorActionPreference = 'Stop'
# 'Stop' alone ignores native exit codes, so a failed adb call would otherwise
# sail past and leave a misleading root count at the end.
$PSNativeCommandUseErrorActionPreference = $true

. C:\tmp\android\env.ps1
$adb = Join-Path $env:ANDROID_SDK_ROOT 'platform-tools\adb.exe'
$certDir = Join-Path $PSScriptRoot 'certs'

$hashName = (Get-ChildItem $certDir -Filter '*.0' | Select-Object -First 1).Name
if (-not $hashName) { throw 'No <hash>.0 CA file found. Run make-certs.ps1 first.' }

& $adb root | Out-Null
Start-Sleep -Seconds 3

# A previous run leaves the bind mount in place, which makes the cp below read
# through its own target and fail with "is the same file". Detect that and skip
# to the force-stops, which are what a re-run is usually for anyway.
$present = & { $PSNativeCommandUseErrorActionPreference = $false
               & $adb shell "test -f /apex/com.android.conscrypt/cacerts/$hashName && echo present" }

if ("$present" -match 'present') {
  Write-Host 'CA already in the system store; skipping staging.'
}
else {
  & $adb push (Join-Path $certDir $hashName) "/data/local/tmp/$hashName" | Out-Null

  # Stage the real store plus our root, with the labels the runtime expects.
  & $adb shell "mkdir -p /data/local/tmp/cacerts-copy && cp /apex/com.android.conscrypt/cacerts/* /data/local/tmp/cacerts-copy/ && cp /data/local/tmp/$hashName /data/local/tmp/cacerts-copy/ && chmod 644 /data/local/tmp/cacerts-copy/*"
  & $adb shell 'chcon -R u:object_r:system_file:s0 /data/local/tmp/cacerts-copy'

  # init's namespace first, then zygote so newly forked apps inherit it.
  & $adb shell 'nsenter --mount=/proc/1/ns/mnt -- mount --bind /data/local/tmp/cacerts-copy /apex/com.android.conscrypt/cacerts'
  & $adb shell 'for pid in $(pidof zygote) $(pidof zygote64); do nsenter --mount=/proc/$pid/ns/mnt -- mount --bind /data/local/tmp/cacerts-copy /apex/com.android.conscrypt/cacerts; done'
}

function Stop-Package {
  <#
  .SYNOPSIS
    Force-stops a package so it re-forks from the patched zygote.
  .DESCRIPTION
    Force-stopping a package that is not installed still exits 0, so there is no
    optional case to tolerate here: any non-zero exit is a real adb, transport or
    permission failure and is left to surface.
  #>
  param([Parameter(Mandatory)][string]$Package)

  & $adb shell am force-stop $Package | Out-Null
}

# The app especially must stop: if it survives it keeps the store it started
# with, which is the exact failure this script exists to prevent.
Stop-Package -Package 'com.android.chrome'
Stop-Package -Package 'com.google.android.webview'
Stop-Package -Package 'com.sergienko4.israelibankimporter'

$count = (& $adb shell 'ls /apex/com.android.conscrypt/cacerts | wc -l').Trim()
Write-Host "System trust store now holds $count roots (including the local CA)."
