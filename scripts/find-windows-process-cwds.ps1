param(
  [Parameter(Mandatory = $true)]
  [string]$Path
)

$source = @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

public static class FoundryProcessDirectory {
  [StructLayout(LayoutKind.Sequential)]
  private struct PROCESS_BASIC_INFORMATION {
    public IntPtr Reserved1;
    public IntPtr PebBaseAddress;
    public IntPtr Reserved2_0;
    public IntPtr Reserved2_1;
    public IntPtr UniqueProcessId;
    public IntPtr Reserved3;
  }

  [DllImport("kernel32.dll", SetLastError = true)]
  private static extern IntPtr OpenProcess(uint access, bool inheritHandle, int processId);

  [DllImport("kernel32.dll")]
  private static extern bool CloseHandle(IntPtr handle);

  [DllImport("kernel32.dll", SetLastError = true)]
  private static extern bool ReadProcessMemory(IntPtr process, IntPtr address, byte[] buffer, int size, out IntPtr bytesRead);

  [DllImport("ntdll.dll")]
  private static extern int NtQueryInformationProcess(IntPtr process, int informationClass, ref PROCESS_BASIC_INFORMATION information, int size, out int returnLength);

  private static IntPtr ReadPointer(IntPtr process, IntPtr address) {
    byte[] bytes = new byte[IntPtr.Size];
    IntPtr read;
    if (!ReadProcessMemory(process, address, bytes, bytes.Length, out read) || read.ToInt64() != bytes.Length) return IntPtr.Zero;
    return IntPtr.Size == 8 ? new IntPtr(BitConverter.ToInt64(bytes, 0)) : new IntPtr(BitConverter.ToInt32(bytes, 0));
  }

  public static string CurrentDirectory(int processId) {
    const uint PROCESS_QUERY_INFORMATION = 0x0400;
    const uint PROCESS_VM_READ = 0x0010;
    IntPtr process = OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, false, processId);
    if (process == IntPtr.Zero) return null;
    try {
      PROCESS_BASIC_INFORMATION basic = new PROCESS_BASIC_INFORMATION();
      int returned;
      if (NtQueryInformationProcess(process, 0, ref basic, Marshal.SizeOf(basic), out returned) != 0 || basic.PebBaseAddress == IntPtr.Zero) return null;
      IntPtr parameters = ReadPointer(process, IntPtr.Add(basic.PebBaseAddress, IntPtr.Size == 8 ? 0x20 : 0x10));
      if (parameters == IntPtr.Zero) return null;
      int currentDirectoryOffset = IntPtr.Size == 8 ? 0x38 : 0x24;
      byte[] unicodeString = new byte[IntPtr.Size == 8 ? 16 : 8];
      IntPtr read;
      if (!ReadProcessMemory(process, IntPtr.Add(parameters, currentDirectoryOffset), unicodeString, unicodeString.Length, out read)) return null;
      ushort length = BitConverter.ToUInt16(unicodeString, 0);
      long bufferAddress = IntPtr.Size == 8 ? BitConverter.ToInt64(unicodeString, 8) : BitConverter.ToInt32(unicodeString, 4);
      if (length == 0 || bufferAddress == 0 || length > 32768) return null;
      byte[] text = new byte[length];
      if (!ReadProcessMemory(process, new IntPtr(bufferAddress), text, text.Length, out read)) return null;
      return System.Text.Encoding.Unicode.GetString(text);
    } finally {
      CloseHandle(process);
    }
  }
}
'@

Add-Type -TypeDefinition $source -ErrorAction Stop
$target = [System.IO.Path]::GetFullPath($Path).TrimEnd('\')
$matches = foreach ($process in Get-Process -ErrorAction SilentlyContinue) {
  try {
    $cwd = [FoundryProcessDirectory]::CurrentDirectory($process.Id)
    if ($cwd) {
      $normalized = [System.IO.Path]::GetFullPath($cwd).TrimEnd('\')
      if ($normalized -ieq $target -or $normalized.StartsWith($target + '\', [System.StringComparison]::OrdinalIgnoreCase)) {
        [pscustomobject]@{ pid = $process.Id; name = $process.ProcessName; currentDirectory = $normalized }
      }
    }
  } catch {
    # Protected/system processes cannot be inspected and are not expected to use a user project cwd.
  }
}
@($matches) | ConvertTo-Json -Compress
