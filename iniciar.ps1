param([switch]$SinNavegador)

$ErrorActionPreference = 'Stop'

try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

$raiz = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $raiz

$rutaDatos = Join-Path $raiz 'datos.sqlite'
$rutaTemporal = Join-Path $raiz 'datos.sqlite.tmp'
$rutaRespaldos = Join-Path $raiz 'respaldos'
$limiteCuerpo = 64MB

# Buscar un puerto libre para el servidor local
$listener = $null
$puerto = 0
for ($p = 8080; $p -le 8120; $p++) {
  try {
    $candidato = New-Object System.Net.HttpListener
    $candidato.Prefixes.Add("http://localhost:$p/")
    $candidato.Start()
    $listener = $candidato
    $puerto = $p
    break
  } catch {
    if ($candidato) {
      try { $candidato.Close() } catch { }
    }
  }
}

if (-not $listener) {
  Write-Host ''
  Write-Host '  No se pudo iniciar el servidor local (puertos 8080 a 8120 ocupados).' -ForegroundColor Red
  Write-Host '  Cerrá otras aplicaciones que estén usando esos puertos e intentá de nuevo.' -ForegroundColor Red
  Write-Host ''
  Read-Host '  Presioná Enter para cerrar'
  exit 1
}

$url = "http://localhost:$puerto/"

Write-Host ''
Write-Host '  Mesa & Evento - Reservas del restaurante' -ForegroundColor Green
Write-Host "  Abriendo $url"
Write-Host ''
Write-Host '  Los datos se guardan en: datos.sqlite' -ForegroundColor DarkGray
Write-Host '  Las copias de seguridad quedan en la carpeta "respaldos".' -ForegroundColor DarkGray
Write-Host '  Para cerrar la aplicación, presioná Ctrl+C en esta ventana.' -ForegroundColor DarkGray
Write-Host ''

if (-not $SinNavegador) { Start-Process $url }

$tipos = @{
  '.html'   = 'text/html; charset=utf-8'
  '.htm'    = 'text/html; charset=utf-8'
  '.css'    = 'text/css; charset=utf-8'
  '.js'     = 'application/javascript; charset=utf-8'
  '.json'   = 'application/json; charset=utf-8'
  '.svg'    = 'image/svg+xml'
  '.png'    = 'image/png'
  '.jpg'    = 'image/jpeg'
  '.jpeg'   = 'image/jpeg'
  '.gif'    = 'image/gif'
  '.ico'    = 'image/x-icon'
  '.wasm'   = 'application/wasm'
  '.sqlite' = 'application/x-sqlite3'
  '.db'     = 'application/x-sqlite3'
  '.txt'    = 'text/plain; charset=utf-8'
  '.md'     = 'text/plain; charset=utf-8'
}

# ---------- respuestas ----------

function Responder-Bytes($contexto, $codigo, [byte[]]$bytes, $tipo) {
  $respuesta = $contexto.Response
  $respuesta.StatusCode = $codigo
  $respuesta.ContentType = $tipo
  $respuesta.Headers.Add('Cache-Control', 'no-store')
  $respuesta.ContentLength64 = $bytes.Length
  $respuesta.OutputStream.Write($bytes, 0, $bytes.Length)
  $respuesta.OutputStream.Close()
}

function Responder-Texto($contexto, $codigo, $texto) {
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($texto)
  Responder-Bytes $contexto $codigo $bytes 'text/plain; charset=utf-8'
}

function Responder-Json($contexto, $codigo, $objeto) {
  $texto = $objeto | ConvertTo-Json -Compress
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($texto)
  Responder-Bytes $contexto $codigo $bytes 'application/json; charset=utf-8'
}

function Responder-Conflicto($contexto, $etag) {
  if ($etag) { $contexto.Response.Headers.Add('ETag', $etag) }
  Responder-Json $contexto 412 @{
    error = 'conflicto'
    mensaje = 'Otra pestaña guardó cambios en la base de datos.'
    etag = $etag
  }
}

# ---------- utilidades de datos ----------

function Obtener-ETag($ruta) {
  if (-not [System.IO.File]::Exists($ruta)) { return $null }
  $info = New-Object System.IO.FileInfo($ruta)
  return '"' + $info.Length + '-' + $info.LastWriteTimeUtc.Ticks + '"'
}

function Es-BaseSQLite([byte[]]$bytes) {
  if ($null -eq $bytes -or $bytes.Length -lt 512) { return $false }
  $cabecera = [System.Text.Encoding]::ASCII.GetString($bytes, 0, 15)
  return $cabecera -eq 'SQLite format 3'
}

function Hash-Bytes([byte[]]$bytes) {
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try { return [Convert]::ToBase64String($sha.ComputeHash($bytes)) }
  finally { $sha.Dispose() }
}

function Hash-Archivo($ruta) {
  $sha = [System.Security.Cryptography.SHA256]::Create()
  $flujo = [System.IO.File]::OpenRead($ruta)
  try { return [Convert]::ToBase64String($sha.ComputeHash($flujo)) }
  finally { $flujo.Dispose(); $sha.Dispose() }
}

function Mismo-Contenido([byte[]]$bytes) {
  if (-not [System.IO.File]::Exists($rutaDatos)) { return $false }
  if ((New-Object System.IO.FileInfo($rutaDatos)).Length -ne $bytes.Length) { return $false }
  return (Hash-Archivo $rutaDatos) -eq (Hash-Bytes $bytes)
}

function Escribir-Atomico([byte[]]$bytes) {
  [System.IO.File]::WriteAllBytes($rutaTemporal, $bytes)
  if ([System.IO.File]::Exists($rutaDatos)) {
    try {
      [System.IO.File]::Replace($rutaTemporal, $rutaDatos, $null)
    } catch {
      Move-Item -LiteralPath $rutaTemporal -Destination $rutaDatos -Force
    }
  } else {
    Move-Item -LiteralPath $rutaTemporal -Destination $rutaDatos -Force
  }
}

function Asegurar-Carpeta($ruta) {
  if (-not [System.IO.Directory]::Exists($ruta)) {
    [System.IO.Directory]::CreateDirectory($ruta) | Out-Null
  }
}

function Crear-Respaldo($carpeta, $nombre) {
  Asegurar-Carpeta $carpeta
  $destino = Join-Path $carpeta $nombre
  [System.IO.File]::Copy($rutaDatos, $destino, $true)
  return $destino
}

function Podar-Respaldos($carpeta, [int]$maximo) {
  if (-not [System.IO.Directory]::Exists($carpeta)) { return }
  $archivos = @(Get-ChildItem -LiteralPath $carpeta -Filter 'datos-*.sqlite' -File -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTimeUtc -Descending)
  if ($archivos.Count -le $maximo) { return }
  $archivos | Select-Object -Skip $maximo | ForEach-Object {
    try { Remove-Item -LiteralPath $_.FullName -Force } catch { }
  }
}

function Respaldar-AntesDeEscribir($motivo) {
  if (-not [System.IO.File]::Exists($rutaDatos)) { return }
  $ahora = Get-Date

  if ($motivo -eq 'importar') {
    $carpeta = Join-Path $rutaRespaldos 'importaciones'
    $nombre = 'datos-' + $ahora.ToString('yyyyMMdd-HHmmss') + '-antes-de-importar.sqlite'
    Crear-Respaldo $carpeta $nombre | Out-Null
    Podar-Respaldos $carpeta 20
    return
  }

  # Una copia diaria: la primera escritura del día guarda el estado con el que cerró el día anterior.
  $carpetaDiarios = Join-Path $rutaRespaldos 'diarios'
  $nombreDiario = 'datos-' + $ahora.ToString('yyyyMMdd') + '.sqlite'
  if (-not [System.IO.File]::Exists((Join-Path $carpetaDiarios $nombreDiario))) {
    Crear-Respaldo $carpetaDiarios $nombreDiario | Out-Null
    Podar-Respaldos $carpetaDiarios 90
  }

  # Copias recientes, como máximo una cada 15 minutos.
  $carpetaRecientes = Join-Path $rutaRespaldos 'recientes'
  $ultimo = $null
  if ([System.IO.Directory]::Exists($carpetaRecientes)) {
    $ultimo = Get-ChildItem -LiteralPath $carpetaRecientes -Filter 'datos-*.sqlite' -File -ErrorAction SilentlyContinue |
      Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
  }
  if (-not $ultimo -or ($ahora.ToUniversalTime() - $ultimo.LastWriteTimeUtc).TotalMinutes -ge 15) {
    $nombreReciente = 'datos-' + $ahora.ToString('yyyyMMdd-HHmm') + '.sqlite'
    Crear-Respaldo $carpetaRecientes $nombreReciente | Out-Null
    Podar-Respaldos $carpetaRecientes 60
  }
}

# ---------- API ----------

function Origen-Valido($contexto) {
  $origen = $contexto.Request.Headers['Origin']
  if ([string]::IsNullOrWhiteSpace($origen)) { return $true }
  $permitidos = @("http://localhost:$puerto", "http://127.0.0.1:$puerto")
  return $permitidos -contains $origen.TrimEnd('/')
}

function Atender-Api($contexto, $ruta) {
  if (-not (Origen-Valido $contexto)) {
    Responder-Json $contexto 403 @{ error = 'Origen no permitido' }
    return
  }

  $metodo = $contexto.Request.HttpMethod

  if ($ruta -eq '/api/estado') {
    if ($metodo -ne 'GET') { Responder-Json $contexto 405 @{ error = 'Método no permitido' }; return }
    $existe = [System.IO.File]::Exists($rutaDatos)
    $info = $null
    if ($existe) { $info = New-Object System.IO.FileInfo($rutaDatos) }
    Responder-Json $contexto 200 @{
      ok = $true
      existe = $existe
      bytes = $(if ($info) { $info.Length } else { 0 })
      modificado = $(if ($info) { $info.LastWriteTime.ToString('o') } else { $null })
      etag = (Obtener-ETag $rutaDatos)
      ruta = $rutaDatos
    }
    return
  }

  if ($ruta -eq '/api/db') {
    if ($metodo -eq 'GET') {
      if (-not [System.IO.File]::Exists($rutaDatos)) {
        Responder-Json $contexto 404 @{ error = 'Todavía no existe datos.sqlite' }
        return
      }
      $etag = Obtener-ETag $rutaDatos
      $bytes = [System.IO.File]::ReadAllBytes($rutaDatos)
      $contexto.Response.Headers.Add('ETag', $etag)
      Responder-Bytes $contexto 200 $bytes 'application/x-sqlite3'
      return
    }

    if ($metodo -eq 'POST') {
      $etagActual = Obtener-ETag $rutaDatos
      if ($etagActual) {
        $ifMatch = $contexto.Request.Headers['If-Match']
        if ([string]::IsNullOrWhiteSpace($ifMatch) -or $ifMatch -ne $etagActual) {
          Responder-Conflicto $contexto $etagActual
          return
        }
      }

      $largo = $contexto.Request.ContentLength64
      if ($largo -le 0) {
        Responder-Json $contexto 411 @{ error = 'Falta Content-Length' }
        return
      }
      if ($largo -gt $limiteCuerpo) {
        Responder-Json $contexto 413 @{ error = 'La base de datos supera el tamaño máximo permitido' }
        return
      }

      $memoria = New-Object System.IO.MemoryStream
      try {
        $buffer = New-Object byte[] 81920
        $leidos = 0
        while ($leidos -lt $largo) {
          $n = $contexto.Request.InputStream.Read($buffer, 0, [Math]::Min($buffer.Length, $largo - $leidos))
          if ($n -le 0) { break }
          $memoria.Write($buffer, 0, $n)
          $leidos += $n
        }
        $bytes = $memoria.ToArray()
      } finally {
        $memoria.Dispose()
      }

      if ($bytes.Length -ne $largo) {
        Responder-Json $contexto 400 @{ error = 'El contenido llegó incompleto' }
        return
      }
      if (-not (Es-BaseSQLite $bytes)) {
        Responder-Json $contexto 400 @{ error = 'El contenido no es una base de datos SQLite válida' }
        return
      }

      if (Mismo-Contenido $bytes) {
        $contexto.Response.Headers.Add('ETag', $etagActual)
        Responder-Json $contexto 200 @{ ok = $true; sinCambios = $true; bytes = $bytes.Length; etag = $etagActual }
        return
      }

      $motivo = $contexto.Request.Headers['X-Motivo']
      Respaldar-AntesDeEscribir $motivo
      Escribir-Atomico $bytes
      $etagNuevo = Obtener-ETag $rutaDatos
      Write-Host ("  Base guardada ({0:N0} KB) -> datos.sqlite" -f ($bytes.Length / 1KB)) -ForegroundColor DarkGray
      $contexto.Response.Headers.Add('ETag', $etagNuevo)
      Responder-Json $contexto 200 @{ ok = $true; bytes = $bytes.Length; etag = $etagNuevo }
      return
    }

    Responder-Json $contexto 405 @{ error = 'Método no permitido' }
    return
  }

  Responder-Json $contexto 404 @{ error = 'Ruta de API no encontrada' }
}

$prefijoRaiz = $raiz.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar

try {
  while ($listener.IsListening) {
    $contexto = $listener.GetContext()
    try {
      $ruta = $contexto.Request.Url.LocalPath
      if ($ruta -eq '/' -or $ruta -eq '') { $ruta = '/index.html' }

      $relativa = [System.Uri]::UnescapeDataString($ruta).TrimStart('/')

      if ($relativa -match '^api(/|$)') {
        Atender-Api $contexto ('/' + $relativa)
        continue
      }

      # La base y sus copias nunca se sirven por HTTP: solo se accede por la API.
      if ($relativa -imatch '^(respaldos|\.git)(/|$)' -or $relativa -imatch '^datos\.sqlite') {
        Responder-Texto $contexto 403 'Acceso denegado'
        continue
      }

      $completa = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($raiz, $relativa))

      if (-not $completa.StartsWith($prefijoRaiz, [System.StringComparison]::OrdinalIgnoreCase)) {
        Responder-Texto $contexto 403 'Acceso denegado'
        continue
      }

      if (-not [System.IO.File]::Exists($completa)) {
        Responder-Texto $contexto 404 'Archivo no encontrado'
        continue
      }

      $bytes = [System.IO.File]::ReadAllBytes($completa)
      $extension = [System.IO.Path]::GetExtension($completa).ToLowerInvariant()
      $respuesta = $contexto.Response
      if ($tipos.ContainsKey($extension)) {
        $respuesta.ContentType = $tipos[$extension]
      } else {
        $respuesta.ContentType = 'application/octet-stream'
      }
      $respuesta.Headers.Add('Cache-Control', 'no-store')
      $respuesta.ContentLength64 = $bytes.Length
      $respuesta.OutputStream.Write($bytes, 0, $bytes.Length)
      $respuesta.OutputStream.Close()
    } catch {
      try { Responder-Texto $contexto 500 'Error interno del servidor local' } catch { }
    }
  }
} finally {
  if ($listener.IsListening) { $listener.Stop() }
  $listener.Close()
  Write-Host ''
  Write-Host '  Servidor detenido. Los datos quedaron guardados en datos.sqlite.' -ForegroundColor DarkGray
  Write-Host ''
}
