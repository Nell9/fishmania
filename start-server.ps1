# KlevGid local static server (no dependencies, PowerShell only)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

$listener = $null
$port = 0
foreach ($p in 8080..8090) {
  try {
    $l = New-Object System.Net.HttpListener
    $l.Prefixes.Add("http://localhost:$p/")
    $l.Start()
    $listener = $l; $port = $p
    break
  } catch { continue }
}
if (-not $listener) {
  Write-Host "ERROR: could not bind ports 8080-8090." -ForegroundColor Red
  Read-Host "Press Enter to exit"
  exit 1
}

$mime = @{
  ".html"="text/html; charset=utf-8"; ".css"="text/css; charset=utf-8"
  ".js"="application/javascript; charset=utf-8"; ".mjs"="application/javascript; charset=utf-8"
  ".json"="application/json; charset=utf-8"; ".svg"="image/svg+xml"
  ".png"="image/png"; ".jpg"="image/jpeg"; ".jpeg"="image/jpeg"; ".gif"="image/gif"
  ".ico"="image/x-icon"; ".woff"="font/woff"; ".woff2"="font/woff2"; ".md"="text/plain; charset=utf-8"
}

Write-Host ""
Write-Host "  KlevGid is running:  http://localhost:$port/" -ForegroundColor Green
Write-Host "  Folder: $root"
Write-Host "  Close this window (or Ctrl+C) to stop the server."
Write-Host ""

Start-Process "http://localhost:$port/"

while ($listener.IsListening) {
  try {
    $ctx = $listener.GetContext()
    $res = $ctx.Response
    $path = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath)
    if ($path -eq "/") { $path = "/index.html" }
    $file = Join-Path $root ($path.TrimStart("/") -replace "/", "\")
    $full = [IO.Path]::GetFullPath($file)

    if ($full.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path $full -PathType Leaf)) {
      $ext = [IO.Path]::GetExtension($full).ToLower()
      $type = $mime[$ext]; if (-not $type) { $type = "application/octet-stream" }
      $bytes = [IO.File]::ReadAllBytes($full)
      $res.ContentType = $type
      $res.Headers.Add("Cache-Control", "no-store")
      $res.ContentLength64 = $bytes.Length
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
      Write-Host ("  200  " + $path)
    } else {
      $res.StatusCode = 404
      $bytes = [Text.Encoding]::UTF8.GetBytes("404 Not Found")
      $res.ContentLength64 = $bytes.Length
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
      Write-Host ("  404  " + $path) -ForegroundColor Yellow
    }
    $res.OutputStream.Close()
  } catch {
    # client aborted or listener stopped - keep serving
  }
}
