using System;
using System.IO;
using System.Text;
using System.Diagnostics;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using System.Reflection;

[assembly: AssemblyTitle("Codex Translate Control Panel")]
[assembly: AssemblyDescription("Standalone User <-> Agent Translator Launcher and Control Panel for ChatGPT and Codex")]
[assembly: AssemblyProduct("Codex Translate")]
[assembly: AssemblyVersion("1.0.0.0")]
[assembly: AssemblyFileVersion("1.0.0.0")]

static class CodexTranslateLauncher {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

    public static List<IntPtr> FindPanelWindows() {
        var list = new List<IntPtr>();
        EnumWindows((hWnd, lParam) => {
            var cls = new StringBuilder(256);
            GetClassName(hWnd, cls, cls.Capacity);
            if (cls.ToString() != "Chrome_WidgetWin_1") return true;
            var sb = new StringBuilder(512);
            GetWindowText(hWnd, sb, sb.Capacity);
            string title = sb.ToString();
            if (title.IndexOf("Codex Translate", StringComparison.OrdinalIgnoreCase) >= 0 &&
                (title.IndexOf("Control Panel", StringComparison.OrdinalIgnoreCase) >= 0 ||
                 title.IndexOf("Панель управления", StringComparison.OrdinalIgnoreCase) >= 0 ||
                 title.IndexOf("控制面板", StringComparison.OrdinalIgnoreCase) >= 0)) {
                list.Add(hWnd);
            }
            return true;
        }, IntPtr.Zero);
        return list;
    }

    public static string ControlExistingWindow(bool toggle) {
        var wins = FindPanelWindows();
        if (wins.Count == 0) return "none";
        IntPtr primary = wins[0];
        for (int i = 1; i < wins.Count; i++) {
            PostMessage(wins[i], 0x0010 /* WM_CLOSE */, IntPtr.Zero, IntPtr.Zero);
        }
        bool isVisible = IsWindowVisible(primary) && !IsIconic(primary);
        if (toggle && isVisible) {
            ShowWindow(primary, 0 /* SW_HIDE */);
            return "hidden";
        } else {
            ShowWindow(primary, 5 /* SW_SHOW */);
            ShowWindow(primary, 9 /* SW_RESTORE */);
            BringWindowToTop(primary);
            SetForegroundWindow(primary);
            return "shown";
        }
    }

    [STAThread]
    static int Main(string[] args) {
        bool isCheck = (args.Length == 1 && args[0] == "--check");
        bool isToggle = (args.Length >= 1 && args[0] == "--toggle");
        try {
            string root = Path.GetFullPath(AppDomain.CurrentDomain.BaseDirectory);
            if (isCheck) {
                Console.Out.WriteLine("{\"ok\":true,\"launcher\":\"CodexTranslate.exe\"}");
                Console.Out.Flush();
                return 0;
            }

            if (args.Length >= 1 && (args[0] == "--on" || args[0] == "--off" || args[0] == "--toggle-translator")) {
                string cliCmd = args[0] == "--on" ? "on" : args[0] == "--off" ? "off" : "toggle";
                string cliPath = Path.Combine(root, "cli.mjs");
                var nodeInfo = new ProcessStartInfo("node.exe", "\"" + cliPath + "\" " + cliCmd + " --json");
                nodeInfo.WorkingDirectory = root;
                nodeInfo.UseShellExecute = false;
                nodeInfo.CreateNoWindow = true;
                using (var p = Process.Start(nodeInfo)) {
                    p.WaitForExit(15000);
                    return p.ExitCode;
                }
            }

            string script = "Panel.ps1";
            if (args.Length >= 1) {
                if (args[0] == "--tray") script = "Tray.ps1";
                else if (args[0] == "--switch") script = "Switch.ps1";
                else if (args[0] == "--panel" || args[0] == "--toggle") script = "Panel.ps1";
            }

            if (script == "Panel.ps1") {
                if (isToggle) {
                    string existing = ControlExistingWindow(true);
                    if (existing != "none") {
                        return 0;
                    }
                }
            }

            string target = Path.Combine(root, script);
            if (!File.Exists(target)) {
                throw new FileNotFoundException("Control panel component not found: " + target, target);
            }

            string psExe = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.Windows),
                "System32", "WindowsPowerShell", "v1.0", "powershell.exe"
            );

            string errFile = Path.Combine(Path.GetTempPath(), "codex-translate-launch-" + Guid.NewGuid().ToString("N") + ".err");
            try {
                string toggleArg = isToggle ? " -Toggle" : "";
                var info = new ProcessStartInfo(
                    psExe,
                    "-NoProfile -STA -WindowStyle Hidden -ExecutionPolicy Bypass -Command \"try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; & '" + target.Replace("'", "''") + "'" + toggleArg + " } catch { [System.IO.File]::WriteAllText('" + errFile.Replace("'", "''") + "', $_.Exception.Message, [System.Text.Encoding]::UTF8); exit 1 }\""
                );
                info.WorkingDirectory = root;
                info.UseShellExecute = false;
                info.CreateNoWindow = true;
                info.WindowStyle = ProcessWindowStyle.Hidden;

                using (var child = Process.Start(info)) {
                    if (script == "Tray.ps1" || script == "Switch.ps1") {
                        return 0;
                    }
                    child.WaitForExit(20000);
                    if (child.HasExited && child.ExitCode != 0) {
                        string msg = File.Exists(errFile) ? File.ReadAllText(errFile, Encoding.UTF8).Trim() : "";
                        throw new Exception(String.IsNullOrWhiteSpace(msg) ? "Could not launch the Codex Translate Control Panel." : msg);
                    }
                }
            } finally {
                try { if (File.Exists(errFile)) File.Delete(errFile); } catch {}
            }
            return 0;
        } catch (Exception error) {
            if (isCheck) {
                Console.Error.WriteLine(error.Message);
                return 1;
            }
            MessageBox.Show(error.Message, "Codex Translate", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }
}
