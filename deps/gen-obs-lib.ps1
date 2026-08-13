# Generate MSVC import libs from installed OBS DLLs (obs + w32-pthreads)
$ErrorActionPreference = 'Stop'
$outDir = Join-Path $PSScriptRoot 'obs-import-lib'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$vs = & "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe" `
  -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 `
  -property installationPath
$vcvars = Join-Path $vs 'VC\Auxiliary\Build\vcvars64.bat'
$bin = 'C:\Program Files\obs-studio\bin\64bit'

function New-ImportLib([string]$DllName) {
  $dll = Join-Path $bin ($DllName + '.dll')
  if (-not (Test-Path $dll)) { throw "Missing $dll" }
  $exportsFile = Join-Path $outDir ($DllName + '-exports.txt')
  $defFile = Join-Path $outDir ($DllName + '.def')
  $libFile = Join-Path $outDir ($DllName + '.lib')

  cmd /c "`"$vcvars`" >nul && dumpbin /EXPORTS `"$dll`" > `"$exportsFile`""

  $defs = New-Object System.Collections.Generic.List[string]
  $defs.Add("LIBRARY $DllName")
  $defs.Add('EXPORTS')
  Get-Content $exportsFile -Encoding Default | ForEach-Object {
    if ($_ -match '^\s+\d+\s+[0-9A-Fa-f]+\s+[0-9A-Fa-f]+\s+(\S+)') {
      $name = $Matches[1]
      if ($name -and $name -ne '=') { $defs.Add('    ' + $name) }
    }
  }
  [System.IO.File]::WriteAllLines($defFile, $defs)
  Write-Host ("$DllName exports: " + (($defs.Count) - 2))
  if ($defs.Count -lt 5) { throw "Failed parsing exports for $DllName" }

  cmd /c "`"$vcvars`" >nul && cd /d `"$outDir`" && lib /nologo /machine:x64 /def:$DllName.def /out:$DllName.lib"
  Get-Item $libFile | ForEach-Object { Write-Host $_.FullName $_.Length }
}

New-ImportLib 'obs'
New-ImportLib 'w32-pthreads'
Write-Host 'Done.'
