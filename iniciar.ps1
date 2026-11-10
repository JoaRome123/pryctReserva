param([switch]$SinNavegador)

$ErrorActionPreference = 'Stop'

try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

$raiz = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $raiz

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
Write-Host '  Los datos se guardan automáticamente en este navegador.' -ForegroundColor DarkGray
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

function Responder-Texto($contexto, $codigo, $texto) {
  $respuesta = $contexto.Response
  $respuesta.StatusCode = $codigo
  $respuesta.ContentType = 'text/plain; charset=utf-8'
  $respuesta.Headers.Add('Cache-Control', 'no-store')
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($texto)
  $respuesta.ContentLength64 = $bytes.Length
  $respuesta.OutputStream.Write($bytes, 0, $bytes.Length)
  $respuesta.OutputStream.Close()
}

$prefijoRaiz = $raiz.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar

try {
  while ($listener.IsListening) {
    $contexto = $listener.GetContext()
    try {
      $ruta = $contexto.Request.Url.LocalPath
      if ($ruta -eq '/' -or $ruta -eq '') { $ruta = '/index.html' }

      $relativa = [System.Uri]::UnescapeDataString($ruta).TrimStart('/')
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
  Write-Host '  Servidor detenido. Los datos quedaron guardados en el navegador.' -ForegroundColor DarkGray
  Write-Host ''
}
