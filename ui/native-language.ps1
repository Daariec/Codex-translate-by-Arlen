# Shared text for the tray and quick switcher. Data files are explicitly UTF-8
# so all three languages also work in Windows PowerShell 5.1.
$script:ctNativeStrings = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'native-strings.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$script:ctUiLanguage = 'en'

function Initialize-UiLanguage([string]$DataDirectory) {
    $script:ctUiLanguage = 'en'
    if (-not $DataDirectory) { return }
    $languageFile = Join-Path $DataDirectory 'provider-ui-state.json'
    if (-not (Test-Path -LiteralPath $languageFile)) { return }
    try {
        $preferences = Get-Content -LiteralPath $languageFile -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($preferences.uiLang -in @('en', 'ru', 'zh')) { $script:ctUiLanguage = [string]$preferences.uiLang }
    } catch {
        Write-Warning 'Could not read the interface language. Using English.'
    }
}

function Get-UiText([string]$Key, [object[]]$Values = @()) {
    $language = $script:ctNativeStrings.PSObject.Properties[$script:ctUiLanguage].Value
    $property = $language.PSObject.Properties[$Key]
    if (-not $property) { throw "Missing interface translation: $Key" }
    if ($Values.Count -eq 0) { return [string]$property.Value }
    return [string]::Format([Globalization.CultureInfo]::GetCultureInfo($script:ctUiLanguage), [string]$property.Value, $Values)
}

function Get-UiError([string]$Message) {
    $result = $Message
    foreach ($entry in $script:ctNativeStrings.en.PSObject.Properties) {
        if ($entry.Name -like 'error.*' -and $result.Contains([string]$entry.Value)) {
            $result = $result.Replace([string]$entry.Value, (Get-UiText $entry.Name))
        }
    }
    $httpError = [regex]::Match($result, 'Server /models returned HTTP (\d+)\.')
    if ($httpError.Success) {
        $result = $result.Replace($httpError.Value, (Get-UiText 'error.http' @($httpError.Groups[1].Value)))
    }
    $missingConnection = [regex]::Match($result, 'No saved connection: ([^\r\n]+)')
    if ($missingConnection.Success) {
        $result = $result.Replace($missingConnection.Value, (Get-UiText 'error.connection' @($missingConnection.Groups[1].Value)))
    }
    return $result
}

function Get-UiEffortLabel([string]$Code) {
    if ($script:ctNativeStrings.en.PSObject.Properties['effort.' + $Code]) {
        return $Code + ' - ' + (Get-UiText ('effort.' + $Code))
    }
    return $Code
}

function Get-UiEffortCode([string]$Label) {
    return ($Label -split ' ')[0]
}
