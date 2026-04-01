$ErrorActionPreference = 'Stop'

$files = @(
  'frontend/index.html',
  'index.html',
  'frontend/js/app.js',
  'js/app.js',
  'frontend/js/screens.js',
  'js/screens.js',
  'frontend/js/creator.js',
  'js/creator.js',
  'frontend/js/api.js',
  'js/api.js'
) | Where-Object { Test-Path $_ }

$patterns = @(
  'Ð',
  'T?o',
  '\?nh',
  'du?c',
  'dang m\?',
  'B?t d?u',
  'k?t thúc',
  'Th?i gian',
  'Chi ti?t',
  'Nhân s\?',
  'Ho?t d?ng',
  'c?u hình',
  'Luu ',
  't?i du?c',
  'Ph?i g?i',
  'Quy d?i',
  'Kh? N',
  'Ch? Admin',
  'g?n nh?t'
)

$hits = @()
foreach ($file in $files) {
  foreach ($pattern in $patterns) {
    $matches = Select-String -Path $file -Pattern $pattern -SimpleMatch -AllMatches
    if ($matches) {
      $hits += $matches
    }
  }
}

if ($hits.Count -gt 0) {
  $hits | Sort-Object Path, LineNumber | ForEach-Object {
    Write-Output ("{0}:{1}: {2}" -f $_.Path, $_.LineNumber, $_.Line.Trim())
  }
  exit 1
}

Write-Output 'MOJIBAKE_CHECK_OK'
