param(
  [switch]$Debug,
  [switch]$SinAbrir
)

# ============================================================
#  Mesa & Evento — compila el APK para Android
#
#  Uso normal:
#    powershell -ExecutionPolicy Bypass -File .\compilar-apk.ps1
#
#  Genera dist\Mesa-y-Evento.apk, listo para copiar al teléfono.
#  Requiere: Node.js, JDK 21 y Android SDK (ver README-ANDROID.md).
# ============================================================

$ErrorActionPreference = 'Stop'
$raiz = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $raiz

function Buscar-Java {
  $bases = @()
  if ($env:JAVA_HOME) { $bases += $env:JAVA_HOME }
  $bases += @(Get-ChildItem "$env:ProgramFiles\Microsoft" -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -like 'jdk-*' } | ForEach-Object { $_.FullName })
  $bases += @(Get-ChildItem "$env:ProgramFiles\Eclipse Adoptium" -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -like 'jdk-*' } | ForEach-Object { $_.FullName })
  $bases += @(Get-ChildItem "$env:ProgramFiles\Java" -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -like 'jdk-*' } | ForEach-Object { $_.FullName })
  $bases += @(Get-ChildItem "$env:LOCALAPPDATA\jdk-*" -Directory -Recurse -Depth 2 -ErrorAction SilentlyContinue |
    ForEach-Object { $_.FullName })

  foreach ($ruta in $bases) {
    if ($ruta -and (Test-Path (Join-Path $ruta 'bin\java.exe'))) { return $ruta }
  }
  return $null
}

function Buscar-Sdk {
  $candidatos = @($env:ANDROID_HOME, $env:ANDROID_SDK_ROOT, (Join-Path $env:LOCALAPPDATA 'Android\Sdk'))
  foreach ($ruta in $candidatos) {
    if ($ruta -and (Test-Path (Join-Path $ruta 'platforms'))) { return $ruta }
  }
  return $null
}

$javaHome = Buscar-Java
if (-not $javaHome) {
  Write-Host ''
  Write-Host '  Falta el JDK 21.' -ForegroundColor Red
  Write-Host '  Instalalo con:  winget install Microsoft.OpenJDK.21' -ForegroundColor Yellow
  Write-Host '  Después volvé a ejecutar este archivo.' -ForegroundColor Yellow
  Write-Host ''
  exit 1
}

$sdk = Buscar-Sdk
if (-not $sdk) {
  Write-Host ''
  Write-Host '  Falta el Android SDK.' -ForegroundColor Red
  Write-Host '  Ver el paso 2 de README-ANDROID.md (una sola vez).' -ForegroundColor Yellow
  Write-Host ''
  exit 1
}

if (-not (Test-Path (Join-Path $sdk 'platforms\android-35'))) {
  Write-Host ''
  Write-Host '  El Android SDK no tiene la plataforma 35.' -ForegroundColor Red
  Write-Host "  Ejecutá:  & '$sdk\cmdline-tools\latest\bin\sdkmanager.bat' 'platforms;android-35' 'build-tools;35.0.0' 'platform-tools'" -ForegroundColor Yellow
  Write-Host ''
  exit 1
}

$env:JAVA_HOME = $javaHome
$env:ANDROID_HOME = $sdk
$env:ANDROID_SDK_ROOT = $sdk

# Gradle necesita saber dónde está el SDK (archivo local, no va al repositorio).
$rutaSdkGradle = $sdk.Replace('\', '/')
Set-Content -LiteralPath (Join-Path $raiz 'android\local.properties') -Value "sdk.dir=$rutaSdkGradle" -Encoding ascii

# Firma de la app: se crea una sola vez y hay que conservarla para poder
# actualizar la app instalada sin desinstalarla.
$carpetaFirma = Join-Path $raiz 'keystore'
$archivoFirma = Join-Path $carpetaFirma 'mesa-y-evento.keystore'
$propiedadesFirma = Join-Path $raiz 'android\keystore.properties'

if (-not (Test-Path $archivoFirma)) {
  New-Item -ItemType Directory -Force -Path $carpetaFirma | Out-Null
  Write-Host '  Creando la clave de firma de la aplicación...' -ForegroundColor DarkGray
  & (Join-Path $javaHome 'bin\keytool.exe') -genkeypair -v `
    -keystore $archivoFirma `
    -alias mesa-y-evento `
    -keyalg RSA -keysize 2048 -validity 10000 `
    -storepass mesayevento -keypass mesayevento `
    -dname "CN=Mesa y Evento, OU=Restaurante, O=Mesa y Evento, C=AR" | Out-Null
}

Set-Content -LiteralPath $propiedadesFirma -Encoding ascii -Value @"
storeFile=../keystore/mesa-y-evento.keystore
storePassword=mesayevento
keyAlias=mesa-y-evento
keyPassword=mesayevento
"@

Write-Host ''
Write-Host '  Mesa & Evento — compilando APK para Android' -ForegroundColor Green
Write-Host "  JDK: $javaHome" -ForegroundColor DarkGray
Write-Host "  SDK: $sdk" -ForegroundColor DarkGray
Write-Host ''

if (-not (Test-Path (Join-Path $raiz 'node_modules'))) {
  Write-Host '  Instalando dependencias (solo la primera vez)...' -ForegroundColor DarkGray
  npm install --no-audit --no-fund
}

npm run android:sync
if ($LASTEXITCODE -ne 0) { throw 'Falló la preparación de los archivos web.' }

Push-Location (Join-Path $raiz 'android')
try {
  if ($Debug) {
    & .\gradlew.bat assembleDebug
    $origen = Join-Path $raiz 'android\app\build\outputs\apk\debug\app-debug.apk'
    $nombre = 'Mesa-y-Evento-debug.apk'
  } else {
    & .\gradlew.bat assembleRelease
    $origen = Join-Path $raiz 'android\app\build\outputs\apk\release\app-release.apk'
    $nombre = 'Mesa-y-Evento.apk'
  }
  if ($LASTEXITCODE -ne 0) { throw 'Falló la compilación de Android.' }
} finally {
  Pop-Location
}

if (-not (Test-Path $origen)) { throw "No se encontró el APK generado en $origen" }

$destino = Join-Path $raiz 'dist'
New-Item -ItemType Directory -Force -Path $destino | Out-Null
$apk = Join-Path $destino $nombre
Copy-Item -LiteralPath $origen -Destination $apk -Force

$tam = [Math]::Round((Get-Item $apk).Length / 1MB, 1)
Write-Host ''
Write-Host '  APK listo.' -ForegroundColor Green
Write-Host "  Archivo: $apk ($tam MB)" -ForegroundColor Green
Write-Host ''
Write-Host '  Para instalarlo: copialo al teléfono y abrilo, o conectá el' -ForegroundColor DarkGray
Write-Host '  teléfono por USB y ejecutá:  adb install -r "' -NoNewline -ForegroundColor DarkGray
Write-Host $apk -NoNewline -ForegroundColor DarkGray
Write-Host '"' -ForegroundColor DarkGray
Write-Host ''

if (-not $SinAbrir) { Start-Process explorer.exe -ArgumentList "/select,`"$apk`"" }
