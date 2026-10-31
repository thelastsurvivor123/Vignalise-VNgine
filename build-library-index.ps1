$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$entries = @()
$bundledFiles = [ordered]@{}

# Shared repository assets:
# - Put each image under this project's assets/ folder (subfolders are supported).
# - The generated path is relative to the project root and uses forward slashes,
#   e.g. assets/backgrounds/forest.webp. Do not add a leading slash or use \.
# - This script creates kind="asset", name (the filename), and mimeType for you.
#   Add an extension-to-MIME mapping below if you introduce a new image format;
#   unsupported extensions are skipped.
# - Reference a shared image in a story with data-background="assets/..." using
#   the generated path. Browser-uploaded project images instead use asset:img-IDs.
# - The VS Code workspace watcher runs this script when stories/ or assets/
#   change. Run it manually if automatic tasks are disabled.
# - Publish library-index.json, library-data.js, and library-revision.js with
#   stories/ and assets/ so the hosted site receives the same source updates.
# library-index.json is generated output; make changes to the folders or this
# script rather than editing the index by hand.
$assetTypes = @{
  ".avif" = "image/avif"
  ".gif" = "image/gif"
  ".jpeg" = "image/jpeg"
  ".jpg" = "image/jpeg"
  ".png" = "image/png"
  ".svg" = "image/svg+xml"
  ".webp" = "image/webp"
}

foreach ($file in Get-ChildItem -LiteralPath (Join-Path $root "stories") -File -Recurse | Sort-Object FullName) {
  if ($file.Extension -match '^\.(html|htm)$') {
    $path = "stories/$($file.FullName.Substring((Join-Path $root "stories").Length + 1).Replace('\', '/'))"
    $entry = @{
      path = $path
      kind = "html"
      name = $file.Name
    }
    $entries += $entry
    $bundledFiles[$path] = $entry + @{
      base64 = [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($file.FullName))
    }
  }
}

foreach ($file in Get-ChildItem -LiteralPath (Join-Path $root "assets") -File -Recurse | Sort-Object FullName) {
  $mimeType = $assetTypes[$file.Extension.ToLowerInvariant()]
  if ($mimeType) {
    $path = "assets/$($file.FullName.Substring((Join-Path $root "assets").Length + 1).Replace('\', '/'))"
    $entry = @{
      path = $path
      kind = "asset"
      name = $file.Name
      mimeType = $mimeType
    }
    $entries += $entry
    $bundledFiles[$path] = $entry + @{
      base64 = [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($file.FullName))
    }
  }
}

$json = ConvertTo-Json -InputObject $entries -Depth 3
$indexPath = Join-Path $root "library-index.json"
[System.IO.File]::WriteAllText($indexPath, $json, (New-Object System.Text.UTF8Encoding($false)))
Write-Output "Updated library index with $($entries.Count) files."

$bundlePath = Join-Path $root "library-data.js"
$bundleJson = ConvertTo-Json -InputObject $bundledFiles -Depth 4 -Compress
[System.IO.File]::WriteAllText(
  $bundlePath,
  "window.VNVngineLibraryFiles = $bundleJson;",
  (New-Object System.Text.UTF8Encoding($false))
)
Write-Output "Updated local library bundle with $($bundledFiles.Count) files."

$revisionPath = Join-Path $root "library-revision.js"
$revision = [DateTime]::UtcNow.Ticks.ToString()
[System.IO.File]::WriteAllText(
  $revisionPath,
  "window.VNVngineLibraryRevision = '$revision';",
  (New-Object System.Text.UTF8Encoding($false))
)
Write-Output "Updated local library revision."
