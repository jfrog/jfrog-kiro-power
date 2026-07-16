# (c) JFrog Ltd. (2026)
# Verifies the prerequisites for the JFrog Kiro Power on Windows (PowerShell).
# Checks: (1) jf CLI present and >= 2.100.0, (2) at least one JFrog server configured.
# Exit 0 = all good; exit 1 = something needs attention.
$ErrorActionPreference = 'SilentlyContinue'
$min = [version]'2.100.0'
$status = 0

Write-Host "JFrog Kiro Power - install check"
Write-Host "--------------------------------"

# 1) jf CLI + version
$jf = Get-Command jf -ErrorAction SilentlyContinue
if (-not $jf) {
  Write-Host "x jf CLI not found on PATH."
  Write-Host "  Install: https://jfrog.com/getting-started-with-jfrog-cli/"
  $status = 1
} else {
  $out = (& jf --version) 2>$null
  $m = [regex]::Match($out, '\d+\.\d+\.\d+')
  if (-not $m.Success) {
    Write-Host "x could not determine jf version (is 'jf' the JFrog CLI?)."
    $status = 1
  } elseif ([version]$m.Value -lt $min) {
    Write-Host "x jf $($m.Value) is below the required $min. Upgrade the JFrog CLI."
    $status = 1
  } else {
    Write-Host "+ jf CLI $($m.Value) (>= $min)"
  }
}

# 2) at least one configured server
$cfg = (& jf config show) 2>$null
if ($jf -and ($cfg -match 'Server ID')) {
  Write-Host "+ JFrog server configured"
} else {
  Write-Host "x no JFrog server configured."
  Write-Host "  Run: jf config add <server-id> --url=https://<host>.jfrog.io --access-token=<token> --interactive=false"
  $status = 1
}

Write-Host "--------------------------------"
if ($status -eq 0) { Write-Host "All checks passed." } else { Write-Host "Some checks failed - see above." }
exit $status
