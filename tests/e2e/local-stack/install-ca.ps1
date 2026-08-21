#!/usr/bin/env pwsh
# Older hosts accept the assignment below without complaint and ignore it, so
# the exit-code guard would disappear with nothing to show for it.
#Requires -Version 7.4
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

# make-certs.ps1 leaves exactly one hash file, so more than one means the certs
# directory holds a root from an earlier subject; picking either silently is how
# the emulator ends up trusting a CA that no longer signs the server cert.
$hashFiles = @(Get-ChildItem $certDir -Filter '*.0' -File)
if ($hashFiles.Count -eq 0) { throw 'No <hash>.0 CA file found. Run make-certs.ps1 first.' }
if ($hashFiles.Count -gt 1) {
  throw "Found $($hashFiles.Count) <hash>.0 files in $certDir. Re-run make-certs.ps1 to leave exactly one."
}
$hashName = $hashFiles[0].Name

& $adb root | Out-Null
& $adb wait-for-device

# adb root restarts adbd, so the transport coming back is not the same as the
# daemon being usable again. A fixed pause is a guess either way; poll until it
# actually answers as root.
$uid = ''
$deadline = (Get-Date).AddSeconds(30)
while ((Get-Date) -lt $deadline) {
  $uid = "$(& { $PSNativeCommandUseErrorActionPreference = $false; & $adb shell id -u })".Trim()
  if ($uid -eq '0') { break }
  Start-Sleep -Milliseconds 500
}
if ($uid -ne '0') { throw "adbd did not come back as root within 30s (id -u returned '$uid')." }

function Invoke-DeviceProbe {
  <#
  .SYNOPSIS
    Asks the emulator a yes/no question and fails when the call itself fails.
  .DESCRIPTION
    A probe answers a question, so a non-zero exit is expected and native exit
    propagation is disabled for it. adb reports a lost device or a refused
    command the same way, with exit 1, so exit codes cannot tell the two apart.
    The probe always prints one of two sentinels instead; output carrying
    neither means the call failed rather than answered.
  #>
  param([Parameter(Mandatory)][string]$Command)

  $out = "$(& { $PSNativeCommandUseErrorActionPreference = $false; & $adb shell $Command })".Trim()
  if ($out -notmatch '\b(present|absent)\b') { throw "Device probe failed: $out" }
  return $out -match '\bpresent\b'
}

function Test-RemotePath {
  <#
  .SYNOPSIS
    Reports whether a path exists on the emulator, optionally inside a namespace.
  #>
  param([Parameter(Mandatory)][string]$Path, [string]$ProcessId)

  $test = "test -f $Path"
  if ($ProcessId) { $test = "nsenter --mount=/proc/$ProcessId/ns/mnt -- $test" }
  return Invoke-DeviceProbe -Command "$test && echo present || echo absent"
}

function Test-CaStoreMounted {
  <#
  .SYNOPSIS
    Reports whether the patched trust store is already bind-mounted.
  .DESCRIPTION
    adb shell runs in init's namespace, which is where the first mount lands, so
    this answers whether the staging directory has become the APEX path itself.
  #>
  $mounted = "grep -q ' /apex/com.android.conscrypt/cacerts ' /proc/mounts"
  return Invoke-DeviceProbe -Command "$mounted && echo present || echo absent"
}

function Get-ZygotePid {
  <#
  .SYNOPSIS
    Returns the pids of the running zygote processes.
  .DESCRIPTION
    Apps fork from zygote, so a patch that misses it never reaches the app. No
    zygote at all means the emulator is not ready, which is a failure rather
    than a step worth skipping. pidof also exits 1 when it simply finds nothing,
    so it prints a sentinel and anything non-numeric is treated as a failed call
    rather than mistaken for a pid.
  #>
  $raw = "$(& { $PSNativeCommandUseErrorActionPreference = $false
                & $adb shell 'pidof zygote zygote64 || echo none' })".Trim()
  $found = @($raw -split '\s+' | Where-Object { $_ -match '^\d+$' })
  if (-not $found -and $raw -ne 'none') { throw "Unable to query zygote processes: $raw" }
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

# Counted locally rather than with a remote ls | wc -l: the pipeline reports
# wc's status, so a failed listing still exits 0 and prints a confident 0.
$roots = & $adb shell 'ls -1 /apex/com.android.conscrypt/cacerts'
$count = @($roots | Where-Object { "$_".Trim() }).Count
Write-Host "System trust store now holds $count roots (including the local CA)."
