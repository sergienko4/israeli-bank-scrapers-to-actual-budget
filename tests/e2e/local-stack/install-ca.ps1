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

  Re-running against an already-patched emulator is safe and repairs a partial
  install: staging, the init mount and each zygote mount are checked separately,
  so a run interrupted between them is finished rather than reported as done.
  The local CA itself is rewritten every run, because regenerating it keeps the
  same file name and a stale copy would otherwise survive unnoticed.

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

function Test-RemotePath {
  <#
  .SYNOPSIS
    Reports whether a path exists on the emulator, optionally inside a namespace.
  .DESCRIPTION
    A missing path makes test exit 1, which is an answer rather than a failure,
    so native exit-code propagation is disabled for the probe itself.
  #>
  param([Parameter(Mandatory)][string]$Path, [string]$ProcessId)

  $probe = "test -f $Path && echo present"
  if ($ProcessId) { $probe = "nsenter --mount=/proc/$ProcessId/ns/mnt -- $probe" }
  $found = & { $PSNativeCommandUseErrorActionPreference = $false; & $adb shell $probe }
  return "$found" -match 'present'
}

function Test-CaStoreMounted {
  <#
  .SYNOPSIS
    Reports whether the patched trust store is already bind-mounted.
  .DESCRIPTION
    adb shell runs in init's namespace, which is where the first mount lands, so
    this answers whether the staging directory has become the APEX path itself.
  #>
  $probe = "grep -q ' /apex/com.android.conscrypt/cacerts ' /proc/mounts && echo present"
  $found = & { $PSNativeCommandUseErrorActionPreference = $false; & $adb shell $probe }
  return "$found" -match 'present'
}

function Get-ZygotePid {
  <#
  .SYNOPSIS
    Returns the pids of the running zygote processes.
  .DESCRIPTION
    Apps fork from zygote, so a patch that misses it never reaches the app. No
    zygote at all means the emulator is not ready, which is a failure rather
    than a step worth skipping.
  #>
  $raw = & { $PSNativeCommandUseErrorActionPreference = $false
             & $adb shell 'pidof zygote zygote64' }
  $found = "$raw".Trim() -split '\s+' | Where-Object { $_ }
  if (-not $found) { throw 'No zygote process found; is the emulator fully booted?' }
  return $found
}

$apexCa = "/apex/com.android.conscrypt/cacerts/$hashName"
$bind = 'mount --bind /data/local/tmp/cacerts-copy /apex/com.android.conscrypt/cacerts'

# Only the bulk copy is guarded, on the condition that actually matters: while
# the mount is live the staging directory and the APEX path are one and the
# same, so copying the real store into it would read through its own target.
& $adb push (Join-Path $certDir $hashName) "/data/local/tmp/$hashName" | Out-Null

if (Test-CaStoreMounted) {
  Write-Host 'System roots already staged; refreshing the local CA only.'
}
else {
  & $adb shell 'mkdir -p /data/local/tmp/cacerts-copy && cp /apex/com.android.conscrypt/cacerts/* /data/local/tmp/cacerts-copy/'
}

# Our own root is rewritten every run. The subject never changes, so a
# regenerated CA keeps the same <hash>.0 name, and a guard on that name alone
# would leave the stale certificate in place while still reporting success.
& $adb shell "cp /data/local/tmp/$hashName /data/local/tmp/cacerts-copy/ && chmod 644 /data/local/tmp/cacerts-copy/*"
& $adb shell 'chcon -R u:object_r:system_file:s0 /data/local/tmp/cacerts-copy'

# Each namespace is repaired on its own. A run interrupted after the init mount
# leaves zygote unpatched, and a guard that only looked at init would skip the
# repair, restart the app and still report a working install.
if (Test-RemotePath -Path $apexCa) { Write-Host 'init namespace already patched.' }
else { & $adb shell "nsenter --mount=/proc/1/ns/mnt -- $bind" }

foreach ($zygotePid in Get-ZygotePid) {
  if (Test-RemotePath -Path $apexCa -ProcessId $zygotePid) { continue }
  & $adb shell "nsenter --mount=/proc/$zygotePid/ns/mnt -- $bind"
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
