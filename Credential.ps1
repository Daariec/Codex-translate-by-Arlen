param(
    [ValidateSet('Protect','Read')][string]$Mode = 'Read',
    [string]$Path,
    [string]$StatePath
)
$ErrorActionPreference = 'Stop'
try {
    Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1') -ErrorAction Stop
    if ($StatePath) {
        $taskState = Get-Content -LiteralPath $StatePath -Raw | ConvertFrom-Json
        $taskConnection = $taskState.connections.PSObject.Properties[$taskState.selected].Value
        if (-not $taskConnection) { throw 'No selected connection' }
        $Path = $taskConnection.credentialFile
    }
    if (-not $Path) { throw 'Credential path required' }
    if ($Mode -eq 'Protect') {
        $taskSecret = [Console]::In.ReadToEnd().Trim()
        if (-not $taskSecret) { throw 'Empty credential' }
        $taskEncrypted = ConvertTo-SecureString $taskSecret -AsPlainText -Force | ConvertFrom-SecureString
        [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($Path)) | Out-Null
        [IO.File]::WriteAllText($Path, $taskEncrypted)
    } else {
        $taskSecure = Get-Content -LiteralPath $Path -Raw | ConvertTo-SecureString
        $taskPlain = (New-Object System.Net.NetworkCredential('', $taskSecure)).Password
        [Console]::Out.Write($taskPlain)
    }
} catch {
    [Console]::Error.WriteLine('Codex Translate credential helper failed. Reconfigure this connection for the current Windows user.')
    exit 1
}
