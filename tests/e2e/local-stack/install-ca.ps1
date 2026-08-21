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

  Chrome and the app are force-stopped at the end so both re-fork from the
  patched zygote. Without that they keep the store they started with and the
  sign-in page fails with ERR_CERT_AUTHORITY_INVALID.

.EXAMPLE
  pwsh tests/e2e/local-stack/install-ca.ps1
#>

$ErrorActionPreference = 'Stop'

. C:\tmp\android\env.ps1
$adb = Join-Path $env:ANDROID_SDK_ROOT 'platform-tools\adb.exe'
$certDir = Join-Path $PSScriptRoot 'certs'

$hashName = (Get-ChildItem $certDir -Filter '*.0' | Select-Object -First 1).Name
if (-not $hashName) { throw 'No <hash>.0 CA file found. Run make-certs.ps1 first.' }

& $adb root | Out-Null
Start-Sleep -Seconds 3

& $adb push (Join-Path $certDir $hashName) "/data/local/tmp/$hashName" | Out-Null

# Stage the real store plus our root, with the labels the runtime expects.
& $adb shell "mkdir -p /data/local/tmp/cacerts-copy && cp /apex/com.android.conscrypt/cacerts/* /data/local/tmp/cacerts-copy/ && cp /data/local/tmp/$hashName /data/local/tmp/cacerts-copy/ && chmod 644 /data/local/tmp/cacerts-copy/*"
& $adb shell 'chcon -R u:object_r:system_file:s0 /data/local/tmp/cacerts-copy'

# init's namespace first, then zygote so newly forked apps inherit it.
& $adb shell 'nsenter --mount=/proc/1/ns/mnt -- mount --bind /data/local/tmp/cacerts-copy /apex/com.android.conscrypt/cacerts'
& $adb shell 'for pid in $(pidof zygote) $(pidof zygote64); do nsenter --mount=/proc/$pid/ns/mnt -- mount --bind /data/local/tmp/cacerts-copy /apex/com.android.conscrypt/cacerts; done'

foreach ($package in @('com.android.chrome', 'com.google.android.webview', 'com.sergienko4.israelibankimporter')) {
  & $adb shell am force-stop $package | Out-Null
}

$count = (& $adb shell 'ls /apex/com.android.conscrypt/cacerts | wc -l').Trim()
Write-Host "System trust store now holds $count roots (including the local CA)."
