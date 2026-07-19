param(
  [Parameter(Mandatory = $true)][int]$ProcessId,
  [Parameter(Mandatory = $true)][string]$ActionsBase64,
  [string]$ExpectedProcessName = "",
  [string]$StartedAtUtc = "",
  [int]$TimeoutMs = 8000
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms

function Normalize-ControlName([string]$Value) {
  if ([string]::IsNullOrWhiteSpace($Value)) { return "" }
  $normalized = $Value.ToLowerInvariant() -replace '[^a-z0-9]', ''
  # Accessibility labels often contain mnemonic underscores, and user requests commonly contain
  # repeated-letter typos. Normalize both sides identically instead of guessing a project label.
  return $normalized -replace '(.)\1+', '$1'
}

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

function Read-ApplicationCrashEvidence([string]$TargetProcessName, [datetime]$StartedAt) {
  if ([string]::IsNullOrWhiteSpace($TargetProcessName)) { return "" }
  $escapedName = [regex]::Escape($TargetProcessName)
  for ($attempt = 0; $attempt -lt 6; $attempt++) {
    try {
      $event = Get-WinEvent -FilterHashtable @{ LogName = 'Application'; StartTime = $StartedAt.AddSeconds(-2) } -MaxEvents 60 -ErrorAction SilentlyContinue |
        Where-Object {
          $_.ProviderName -in '.NET Runtime', 'Application Error', 'Windows Error Reporting' -and
          $_.Message -match $escapedName
        } |
        Sort-Object TimeCreated -Descending |
        Select-Object -First 1
      if ($null -ne $event) {
        $message = [string]$event.Message
        if ($message.Length -gt 16000) { $message = $message.Substring(0, 16000) }
        return "Windows Application event $($event.Id) from $($event.ProviderName):`n$message"
      }
    } catch { }
    Start-Sleep -Milliseconds 250
  }
  return ""
}

function Find-Control(
  [System.Windows.Automation.AutomationElement]$Window,
  [string]$Name,
  [string]$AutomationId
) {
  $requestedName = Normalize-ControlName $Name
  $requestedId = Normalize-ControlName $AutomationId
  if (-not $requestedName -and -not $requestedId) { return $null }

  $elements = $Window.FindAll(
    [System.Windows.Automation.TreeScope]::Descendants,
    [System.Windows.Automation.Condition]::TrueCondition
  )
  $matches = New-Object System.Collections.Generic.List[object]
  $candidateNames = New-Object System.Collections.Generic.List[string]
  foreach ($element in $elements) {
    try {
      $currentName = [string]$element.Current.Name
      $currentId = [string]$element.Current.AutomationId
      if ($currentName -and $candidateNames.Count -lt 80 -and -not $candidateNames.Contains($currentName)) {
        $candidateNames.Add($currentName)
      }
      $normalizedName = Normalize-ControlName $currentName
      $normalizedId = Normalize-ControlName $currentId
      $nameMatch = $requestedName -and $normalizedName -eq $requestedName
      $idMatch = $requestedId -and $normalizedId -eq $requestedId
      $containsMatch = $requestedName.Length -ge 4 -and $normalizedName -and ($normalizedName.Contains($requestedName) -or $requestedName.Contains($normalizedName))
      if ($nameMatch -or $idMatch -or $containsMatch) {
        $matches.Add([PSCustomObject]@{
          Element = $element
          MatchedName = $currentName
          AutomationId = $currentId
          Score = if ($idMatch) { 0 } elseif ($nameMatch) { 1 } else { 2 }
        })
      }
    } catch { }
  }
  if ($matches.Count -eq 0) {
    return [PSCustomObject]@{ Element = $null; MatchedName = ""; AutomationId = ""; CandidateNames = @($candidateNames) }
  }
  $selected = $matches | Sort-Object Score | Select-Object -First 1
  return [PSCustomObject]@{
    Element = $selected.Element
    MatchedName = $selected.MatchedName
    AutomationId = $selected.AutomationId
    CandidateNames = @($candidateNames)
  }
}

function Invoke-Control([System.Windows.Automation.AutomationElement]$Element) {
  $current = $Element
  for ($depth = 0; $depth -lt 6 -and $null -ne $current; $depth++) {
    try {
      $pattern = $null
      if ($current.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) {
        ([System.Windows.Automation.InvokePattern]$pattern).Invoke()
        return [PSCustomObject]@{ Ok = $true; Invoked = $true; Method = "InvokePattern"; Reason = "Invoked through Windows UI Automation." }
      }
      if ($current.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$pattern)) {
        ([System.Windows.Automation.SelectionItemPattern]$pattern).Select()
        return [PSCustomObject]@{ Ok = $true; Invoked = $true; Method = "SelectionItemPattern"; Reason = "Selected through Windows UI Automation." }
      }
      if ($current.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$pattern)) {
        ([System.Windows.Automation.TogglePattern]$pattern).Toggle()
        return [PSCustomObject]@{ Ok = $true; Invoked = $true; Method = "TogglePattern"; Reason = "Toggled through Windows UI Automation." }
      }
      if ($current.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern, [ref]$pattern)) {
        ([System.Windows.Automation.ExpandCollapsePattern]$pattern).Expand()
        return [PSCustomObject]@{ Ok = $true; Invoked = $true; Method = "ExpandCollapsePattern"; Reason = "Expanded through Windows UI Automation." }
      }
    } catch {
      return [PSCustomObject]@{ Ok = $false; Invoked = $false; Method = ""; Reason = $_.Exception.Message }
    }
    try { $current = [System.Windows.Automation.TreeWalker]::RawViewWalker.GetParent($current) } catch { $current = $null }
  }

  # Some custom controls expose a focusable accessibility node but no action pattern. Keyboard
  # activation is a validator fallback, not source evidence, and is attempted only after a strong
  # normalized name/id match.
  try {
    $Element.SetFocus()
    [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
    return [PSCustomObject]@{ Ok = $true; Invoked = $true; Method = "KeyboardEnter"; Reason = "Activated the matched control through accessibility focus and Enter." }
  } catch {
    return [PSCustomObject]@{ Ok = $false; Invoked = $false; Method = ""; Reason = "The matched accessibility element exposed no supported action pattern or focus activation." }
  }
}

$json = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($ActionsBase64))
$actions = @($json | ConvertFrom-Json)
$steps = New-Object System.Collections.Generic.List[object]
$validationStartedAt = if ($StartedAtUtc) { ([datetime]::Parse($StartedAtUtc)).ToLocalTime() } else { Get-Date }
$processBeforeValidation = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
$processName = if ($null -ne $processBeforeValidation) { [string]$processBeforeValidation.ProcessName } else { $ExpectedProcessName }
$window = Find-ProcessWindow -TargetProcessId $ProcessId -DeadlineMs $TimeoutMs
if ($null -eq $window) {
  $processWithoutWindow = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
  $exitedDuringValidation = $null -eq $processWithoutWindow
  $startupCrashEvidence = if ($exitedDuringValidation) { Read-ApplicationCrashEvidence -TargetProcessName $processName -StartedAt $validationStartedAt } else { "" }
  [PSCustomObject]@{
    verified = $false
    repairEligible = $exitedDuringValidation
    failureKind = if ($exitedDuringValidation) { "application-exited-during-validation" } else { "validator-no-window" }
    reason = if ($exitedDuringValidation) { "The application exited before the desktop validator could confirm the requested interaction. Operating-system crash evidence determines the repair target." } else { "The application process started, but the desktop validator could not discover an accessible top-level window. No source repair was authorized." }
    crashEvidence = $startupCrashEvidence
    steps = @()
    windowTitles = @()
  } | ConvertTo-Json -Depth 8 -Compress
  exit 0
}

foreach ($action in $actions) {
  $kind = [string]$action.action
  $name = [string]$action.name
  $automationId = [string]$action.automationId
  $target = if ($name) { $name } else { $automationId }
  if ($kind -ne "click") {
    $steps.Add([PSCustomObject]@{ action = $kind; target = $target; matchedName = ""; ok = $false; invoked = $false; failureKind = "validator-unsupported-action"; reason = "The desktop validator does not support this action." })
    continue
  }
  $match = Find-Control -Window $window -Name $name -AutomationId $automationId
  if ($null -eq $match -or $null -eq $match.Element) {
    $candidates = if ($null -ne $match) { @($match.CandidateNames | Select-Object -First 20) } else { @() }
    $steps.Add([PSCustomObject]@{ action = $kind; target = $target; matchedName = ""; ok = $false; invoked = $false; failureKind = "validator-control-not-found"; reason = "No accessible control matched the normalized requested name or automation id."; candidates = $candidates })
    continue
  }
  $invocation = Invoke-Control -Element $match.Element
  if (-not $invocation.Ok) {
    $steps.Add([PSCustomObject]@{ action = $kind; target = $target; matchedName = $match.MatchedName; ok = $false; invoked = $false; failureKind = "validator-control-not-actionable"; reason = $invocation.Reason; candidates = @() })
    continue
  }
  Start-Sleep -Milliseconds 650
  $processAfterAction = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
  if ($null -eq $processAfterAction) {
    $steps.Add([PSCustomObject]@{ action = $kind; target = $target; matchedName = $match.MatchedName; ok = $false; invoked = $true; invocationMethod = $invocation.Method; failureKind = "application-exited-after-action"; reason = "The matched control was invoked, then the application process exited."; candidates = @() })
    break
  }
  $steps.Add([PSCustomObject]@{ action = $kind; target = $target; matchedName = $match.MatchedName; ok = $true; invoked = $true; invocationMethod = $invocation.Method; failureKind = ""; reason = $invocation.Reason; candidates = @() })
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
$failedSteps = @($steps | Where-Object { -not $_.ok })
$allPassed = $steps.Count -gt 0 -and $failedSteps.Count -eq 0
$applicationFailure = @($failedSteps | Where-Object { $_.failureKind -eq "application-exited-after-action" }).Count -gt 0
$crashEvidence = if ($applicationFailure) { Read-ApplicationCrashEvidence -TargetProcessName $processName -StartedAt $validationStartedAt } else { "" }
$firstFailure = $failedSteps | Select-Object -First 1
$reason = if ($null -eq $process -and $applicationFailure) {
  "The requested control was invoked and the application exited. This is application evidence and is eligible for source repair."
} elseif ($allPassed) {
  "Every requested desktop interaction completed and the application remained running."
} elseif ($null -ne $firstFailure) {
  "Desktop validator limitation for '$($firstFailure.target)': $($firstFailure.reason) No source repair was authorized."
} else {
  "The desktop validator produced no completed interaction steps. No source repair was authorized."
}

[PSCustomObject]@{
  verified = ($null -ne $process) -and $allPassed
  repairEligible = $applicationFailure
  failureKind = if ($allPassed) { "" } elseif ($applicationFailure) { "application-exited-after-action" } elseif ($null -ne $firstFailure) { $firstFailure.failureKind } else { "validator-no-evidence" }
  reason = $reason
  crashEvidence = $crashEvidence
  steps = $steps
  windowTitles = $windowTitles
} | ConvertTo-Json -Depth 8 -Compress
