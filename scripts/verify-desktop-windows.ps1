param([Parameter(Mandatory = $true)][string]$Candidate)

$ErrorActionPreference = 'Stop'
$installer = @(Get-ChildItem -LiteralPath $Candidate -Filter '*-setup.exe')
if ($installer.Count -ne 1) { throw 'Expected a single NSIS installer' }
$installDirectory = Join-Path $env:RUNNER_TEMP 'keepany-acceptance-install'
$exe = Join-Path $installDirectory 'keepany.exe'
$uninstaller = Join-Path $installDirectory 'uninstall.exe'
if (Test-Path -LiteralPath $installDirectory) { throw 'Install location is not empty' }

function Test-KeepAnyWindow {
    $app = Start-Process -FilePath $exe -PassThru
    try {
        $deadline = (Get-Date).AddSeconds(40)
        do {
            Start-Sleep -Milliseconds 250
            $app.Refresh()
            if ($app.HasExited) { throw "KeepAny exited before opening a window: $($app.ExitCode)" }
            if ($app.MainWindowHandle -ne 0 -and $app.MainWindowTitle -eq 'KeepAny') {
                Write-Output "Observed KeepAny window on $env:PROCESSOR_ARCHITECTURE"
                return
            }
        } while ((Get-Date) -lt $deadline)
        throw 'KeepAny window did not become visible'
    } finally {
        if (-not $app.HasExited) {
            $null = $app.CloseMainWindow()
            if (-not $app.WaitForExit(5000)) {
                Stop-Process -Id $app.Id -Force
                $app.WaitForExit()
            }
        }
        $app.Dispose()
    }
}

try {
    $install = Start-Process -FilePath $installer[0].FullName -ArgumentList @('/S', "/D=$installDirectory") -Wait -PassThru
    if ($install.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $exe)) {
        throw "KeepAny installer failed: $($install.ExitCode)"
    }
    if (-not (Test-Path -LiteralPath $uninstaller)) { throw 'Installed KeepAny has no uninstaller' }
    Test-KeepAnyWindow
    Test-KeepAnyWindow
} finally {
    if (Test-Path -LiteralPath $uninstaller) {
        $uninstall = Start-Process -FilePath $uninstaller -ArgumentList @('/S', "_?=$installDirectory") -Wait -PassThru
        if ($uninstall.ExitCode -ne 0) { throw "KeepAny uninstaller failed: $($uninstall.ExitCode)" }
    }
}
if (Test-Path -LiteralPath $exe) { throw 'Uninstall left KeepAny installed' }
