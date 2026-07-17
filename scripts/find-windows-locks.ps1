param(
  [Parameter(Mandatory = $true)]
  [string]$Path
)

$source = @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class FoundryRestartManager {
  public const int ERROR_MORE_DATA = 234;
  public const int CCH_RM_MAX_APP_NAME = 255;
  public const int CCH_RM_MAX_SVC_NAME = 63;

  [StructLayout(LayoutKind.Sequential)]
  public struct RM_UNIQUE_PROCESS {
    public int dwProcessId;
    public System.Runtime.InteropServices.ComTypes.FILETIME ProcessStartTime;
  }

  public enum RM_APP_TYPE {
    RmUnknownApp = 0,
    RmMainWindow = 1,
    RmOtherWindow = 2,
    RmService = 3,
    RmExplorer = 4,
    RmConsole = 5,
    RmCritical = 1000
  }

  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct RM_PROCESS_INFO {
    public RM_UNIQUE_PROCESS Process;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = CCH_RM_MAX_APP_NAME + 1)]
    public string strAppName;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = CCH_RM_MAX_SVC_NAME + 1)]
    public string strServiceShortName;
    public RM_APP_TYPE ApplicationType;
    public uint AppStatus;
    public uint TSSessionId;
    [MarshalAs(UnmanagedType.Bool)]
    public bool bRestartable;
  }

  [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)]
  public static extern int RmStartSession(out uint pSessionHandle, int dwSessionFlags, StringBuilder strSessionKey);

  [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)]
  public static extern int RmRegisterResources(uint pSessionHandle, uint nFiles, string[] rgsFileNames, uint nApplications, RM_UNIQUE_PROCESS[] rgApplications, uint nServices, string[] rgsServiceNames);

  [DllImport("rstrtmgr.dll")]
  public static extern int RmGetList(uint dwSessionHandle, out uint pnProcInfoNeeded, ref uint pnProcInfo, [In, Out] RM_PROCESS_INFO[] rgAffectedApps, ref uint lpdwRebootReasons);

  [DllImport("rstrtmgr.dll")]
  public static extern int RmEndSession(uint pSessionHandle);
}
'@

Add-Type -TypeDefinition $source -ErrorAction Stop
$fullPath = [System.IO.Path]::GetFullPath($Path)
$sessionHandle = [uint32]0
$sessionKey = New-Object System.Text.StringBuilder 64
$started = [FoundryRestartManager]::RmStartSession([ref]$sessionHandle, 0, $sessionKey)
if ($started -ne 0) { throw "Restart Manager could not start a session (error $started)." }

try {
  $registered = [FoundryRestartManager]::RmRegisterResources($sessionHandle, 1, [string[]]@($fullPath), 0, $null, 0, $null)
  if ($registered -ne 0) { throw "Restart Manager could not inspect the path (error $registered)." }

  $needed = [uint32]0
  $count = [uint32]0
  $rebootReasons = [uint32]0
  $result = [FoundryRestartManager]::RmGetList($sessionHandle, [ref]$needed, [ref]$count, $null, [ref]$rebootReasons)
  if ($result -eq [FoundryRestartManager]::ERROR_MORE_DATA) {
    $processes = New-Object FoundryRestartManager+RM_PROCESS_INFO[] $needed
    $count = $needed
    $result = [FoundryRestartManager]::RmGetList($sessionHandle, [ref]$needed, [ref]$count, $processes, [ref]$rebootReasons)
    if ($result -ne 0) { throw "Restart Manager could not list lock owners (error $result)." }
    $processes | Select-Object @{Name='pid';Expression={$_.Process.dwProcessId}}, @{Name='appName';Expression={$_.strAppName}}, @{Name='serviceName';Expression={$_.strServiceShortName}}, @{Name='applicationType';Expression={$_.ApplicationType.ToString()}}, @{Name='restartable';Expression={$_.bRestartable}} | ConvertTo-Json -Compress
  } elseif ($result -eq 0) {
    '[]'
  } else {
    throw "Restart Manager could not query lock owners (error $result)."
  }
} finally {
  [void][FoundryRestartManager]::RmEndSession($sessionHandle)
}
