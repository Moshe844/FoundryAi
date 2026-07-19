param(
  [Parameter(Mandatory = $true)][string]$ProcessName,
  [Parameter(Mandatory = $true)][string]$StartedAtUtc,
  [int]$MaxWaitMs = 4000
)

$ErrorActionPreference = "Stop"
$startedAt = ([datetime]::Parse($StartedAtUtc)).ToLocalTime()
$deadline = [Environment]::TickCount64 + [Math]::Max(250, [Math]::Min(8000, $MaxWaitMs))
$escapedName = [regex]::Escape($ProcessName)

do {
  try {
    $event = Get-WinEvent -FilterHashtable @{ LogName = 'Application'; StartTime = $startedAt.AddSeconds(-2) } -MaxEvents 60 -ErrorAction SilentlyContinue |
      Where-Object {
        $_.ProviderName -in '.NET Runtime', 'Application Error', 'Windows Error Reporting' -and
        $_.Message -match $escapedName
      } |
      Sort-Object TimeCreated -Descending |
      Select-Object -First 1
    if ($null -ne $event) {
      $message = [string]$event.Message
      if ($message.Length -gt 16000) { $message = $message.Substring(0, 16000) }
      [PSCustomObject]@{
        found = $true
        provider = [string]$event.ProviderName
        eventId = [int]$event.Id
        timeCreated = $event.TimeCreated.ToUniversalTime().ToString('o')
        evidence = "Windows Application event $($event.Id) from $($event.ProviderName):`n$message"
      } | ConvertTo-Json -Depth 4 -Compress
      exit 0
    }
  } catch { }
  Start-Sleep -Milliseconds 250
} while ([Environment]::TickCount64 -lt $deadline)

[PSCustomObject]@{
  found = $false
  evidence = "No matching Windows Application crash event became available within the bounded diagnostic window."
} | ConvertTo-Json -Depth 4 -Compress
