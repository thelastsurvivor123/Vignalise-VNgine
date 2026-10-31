$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$watchers = @()
$subscriptions = @()

try {
  foreach ($directory in @("stories", "assets")) {
    $path = Join-Path $root $directory
    if (-not (Test-Path -LiteralPath $path -PathType Container)) {
      throw "Shared library folder '$path' does not exist."
    }

    $watcher = New-Object System.IO.FileSystemWatcher
    $watcher.Path = $path
    $watcher.Filter = "*"
    $watcher.IncludeSubdirectories = $true
    $watcher.NotifyFilter = [System.IO.NotifyFilters]::FileName -bor
      [System.IO.NotifyFilters]::DirectoryName -bor
      [System.IO.NotifyFilters]::LastWrite -bor
      [System.IO.NotifyFilters]::Size
    $watcher.EnableRaisingEvents = $true
    $watchers += $watcher

    foreach ($eventName in @("Changed", "Created", "Deleted", "Renamed")) {
      $sourceIdentifier = "VNVngineLibrary-$directory-$eventName"
      Register-ObjectEvent -InputObject $watcher -EventName $eventName -SourceIdentifier $sourceIdentifier | Out-Null
      $subscriptions += $sourceIdentifier
    }
  }

  Write-Host "Watching stories/ and assets/. Save a source file to refresh the browser library."
  & (Join-Path $root "build-library-index.ps1")

  while ($true) {
    $event = Wait-Event -Timeout 1
    if (-not $event) { continue }
    Remove-Event -EventIdentifier $event.EventIdentifier
    Start-Sleep -Milliseconds 400
    Get-Event | Remove-Event

    try {
      & (Join-Path $root "build-library-index.ps1")
    } catch {
      Write-Error "Could not rebuild the shared library: $_"
    }
  }
} finally {
  foreach ($subscription in $subscriptions) {
    Unregister-Event -SourceIdentifier $subscription -ErrorAction SilentlyContinue
  }
  foreach ($watcher in $watchers) {
    $watcher.EnableRaisingEvents = $false
    $watcher.Dispose()
  }
}
