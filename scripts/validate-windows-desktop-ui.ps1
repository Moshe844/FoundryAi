param(
  [Parameter(Mandatory = $true)][int]$ProcessId,
  [Parameter(Mandatory = $true)][string]$ActionsBase64,
  [int]$TimeoutMs = 8000
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

function Find-ProcessWindow([int]$TargetProcessId, [int]$DeadlineMs) {
  $started = [Environment]::TickCount64
  do {
    $condition = New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::ProcessIdProperty,
      $TargetProcessId
    )
    $window = [System.Windows.Automation.AutomationElement]::RootElement.FindFirst(
      [System.Windows.Automation.TreeScope]::Children,
      $condition
    )
    if ($null -ne $window) { return $window }
    Start-Sleep -Milliseconds 150
  } while (([Environment]::TickCount64 - $started) -lt $DeadlineMs)
  return $null
}

function Find-Control(
  [System.Windows.Automation.AutomationElement]$Window,
  [string]$Name,
  [string]$AutomationId
) {
  $conditions = New-Object System.Collections.Generic.List[System.Windows.Automation.Condition]
  if (-not [string]::IsNullOrWhiteSpace($AutomationId)) {
    $conditions.Add((New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::AutomationIdProperty,
      $AutomationId,
      [System.Windows.Automation.PropertyConditionFlags]::IgnoreCase
    )))
  }
  if (-not [string]::IsNullOrWhiteSpace($Name)) {
    $conditions.Add((New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::NameProperty,
      $Name,
      [System.Windows.Automation.PropertyConditionFlags]::IgnoreCase
    )))
  }
  if ($conditions.Count -eq 0) { return $null }
  $condition = if ($conditions.Count -eq 1) {
    $conditions[0]
  } else {
    New-Object System.Windows.Automation.OrCondition($conditions.ToArray())
  }
  return $Window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)
}

$json = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($ActionsBase64))
$actions = @($json | ConvertFrom-Json)
$steps = New-Object System.Collections.Generic.List[object]
$window = Find-ProcessWindow -TargetProcessId $ProcessId -DeadlineMs $TimeoutMs
if ($null -eq $window) {
  [PSCustomObject]@{
    verified = $false
    reason = "The application process started, but no accessible top-level window appeared."
    steps = @()
    windowTitles = @()
  } | ConvertTo-Json -Depth 6 -Compress
  exit 0
}

foreach ($action in $actions) {
  $kind = [string]$action.action
  $name = [string]$action.name
  $automationId = [string]$action.automationId
  if ($kind -ne "click") {
    $steps.Add([PSCustomObject]@{ action = $kind; target = $name; ok = $false; reason = "Unsupported desktop action." })
    continue
  }
  $control = Find-Control -Window $window -Name $name -AutomationId $automationId
  if ($null -eq $control) {
    $steps.Add([PSCustomObject]@{ action = $kind; target = $(if ($name) { $name } else { $automationId }); ok = $false; reason = "No accessible control matched the requested name or automation id." })
    continue
  }
  $pattern = $null
  $invoked = $control.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)
  if ($invoked) {
    ([System.Windows.Automation.InvokePattern]$pattern).Invoke()
    Start-Sleep -Milliseconds 500
    $steps.Add([PSCustomObject]@{ action = $kind; target = $(if ($name) { $name } else { $automationId }); ok = $true; reason = "Invoked through Windows UI Automation." })
  } else {
    $steps.Add([PSCustomObject]@{ action = $kind; target = $(if ($name) { $name } else { $automationId }); ok = $false; reason = "The matching control does not expose an invokable accessibility pattern." })
  }
  $nextWindow = Find-ProcessWindow -TargetProcessId $ProcessId -DeadlineMs 1500
  if ($null -ne $nextWindow) { $window = $nextWindow }
}

$process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
$windows = [System.Windows.Automation.AutomationElement]::RootElement.FindAll(
  [System.Windows.Automation.TreeScope]::Children,
  (New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ProcessIdProperty,
    $ProcessId
  ))
)
$windowTitles = @($windows | ForEach-Object { $_.Current.Name } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
$allPassed = $steps.Count -gt 0 -and @($steps | Where-Object { -not $_.ok }).Count -eq 0

[PSCustomObject]@{
  verified = ($null -ne $process) -and $allPassed
  reason = if ($null -eq $process) {
    "The application exited while exercising the requested desktop interaction."
  } elseif ($allPassed) {
    "Every requested desktop interaction completed and the application remained running."
  } else {
    "One or more requested desktop interactions could not be completed."
  }
  steps = $steps
  windowTitles = $windowTitles
} | ConvertTo-Json -Depth 6 -Compress
