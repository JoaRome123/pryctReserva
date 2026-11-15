# Mesa & Evento en Android

La misma aplicación de reservas, empaquetada como una app Android (APK) con
**Capacitor**. Funciona **sin conexión y sin la PC**: la base SQLite vive dentro del
teléfono, en el almacenamiento privado de la app.

---

## Instalar la app en el teléfono

1. Copiá `dist\Mesa-y-Evento.apk` al teléfono (por cable USB, Google Drive, WhatsApp, etc.).
2. Abrí el archivo desde el teléfono.
3. Android va a pedir permiso para instalar apps de origen desconocido:
   **Configuración → Aplicaciones → Acceso especial → Instalar apps desconocidas**,
   y habilitá el permiso para la app con la que abriste el archivo (Archivos, Chrome, etc.).
4. Tocá **Instalar** y después **Abrir**. El ícono de cubiertos queda en el cajón de apps.

> Es normal que Google Play Protect muestre un aviso por ser una app fuera de la tienda.
> Elegí **Instalar de todas formas**.

> Funciona en **Android 6.0 o superior**, con el WebView de Android actualizado
> (se actualiza solo desde Play Store). Recomendado: Android 8 o superior.

### Actualizar la app

Volvé a compilar el APK y copialo al teléfono. Al instalarlo encima del anterior, los
datos se conservan. Para eso el APK tiene que estar firmado con la **misma clave**
(`keystore\mesa-y-evento.keystore`): no borres esa carpeta.

---

## Qué cambia respecto de la versión de Windows

| | Windows (`iniciar.bat`) | Android (APK) |
| --- | --- | --- |
| Motor | Servidor local + Chrome | WebView de Android |
| Datos | Archivo `datos.sqlite` junto al programa | Almacenamiento privado de la app (IndexedDB) |
| Copias automáticas | Carpeta `respaldos` | No hay carpeta; usá **Exportar** |
| Exportar | Descarga el `.sqlite` | Abre el menú de Android para guardar/compartir el `.sqlite` |
| Exportar Excel | Descarga `reservas-*.xlsx` / `pagos-*.xlsx` | Abre el menú de Android para guardar/compartir el `.xlsx` |
| Importar | Elegís el archivo | Elegís el archivo (puede estar en Descargas, Drive, etc.) |
| Conexión | Ninguna | Ninguna |

En el celular no existe `datos.sqlite` a la vista: Android guarda esa base dentro de la app.
Por eso **conviene exportar una copia de vez en cuando** desde el botón *Exportar* y
guardarla en Drive o en el teléfono. Esa copia se puede importar tanto en Android como en
la versión de Windows (son exactamente el mismo formato SQLite).

Si desinstalás la app, Android borra sus datos. Exportá antes de desinstalar.

---

## Cómo está armado

```
Proyecto predeterminado/
├── index.html, css/, js/, vendor/   Aplicación web (la misma de Windows)
├── src/nativo.js                    Puente con Android (se compila a js/nativo.js)
├── scripts/
│   ├── preparar-www.mjs             Arma la carpeta www/ que se empaqueta
│   └── generar-iconos.mjs           Genera íconos y pantalla de inicio
├── assets/                          PNG de ícono y splash (1024×1024 / 2732×2732)
├── capacitor.config.json            Configuración de Capacitor
├── compilar-apk.ps1                 Compila el APK y lo deja en dist/
├── android/                         Proyecto Android nativo (Gradle)
├── www/                             Copia generada de la app (no editar)
└── dist/Mesa-y-Evento.apk           APK instalable (se genera)
```

La app web se copia a `www/` y Capacitor la mete dentro del APK. En Android,
`js/nativo.js`:

- configura la barra de estado y los márgenes seguros de la pantalla;
- hace que el botón **atrás** cierre los diálogos antes de salir;
- reemplaza la descarga del navegador por el menú de Android al **Exportar** (sirve para la
  copia `.sqlite` y para las planillas `.xlsx` de Reservas y Pagos).

`js/db.js` detecta que corre en Android y guarda directamente en el teléfono, sin
intentar conectarse al servidor local de Windows.

---

## Volver a compilar el APK

### Requisitos (una sola vez en la PC)

1. **Node.js 20 o superior** (ya lo usa el proyecto).
2. **JDK 21**:

   ```powershell
   winget install Microsoft.OpenJDK.21
   ```

3. **Android SDK** (sin Android Studio):

   ```powershell
   $sdk = "$env:LOCALAPPDATA\Android\Sdk"
   New-Item -ItemType Directory -Force "$sdk\cmdline-tools" | Out-Null
   Invoke-WebRequest https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip -OutFile "$env:TEMP\cmdline-tools.zip"
   Expand-Archive "$env:TEMP\cmdline-tools.zip" "$env:TEMP\cmdline-tools" -Force
   Move-Item "$env:TEMP\cmdline-tools\cmdline-tools" "$sdk\cmdline-tools\latest"
   & "$sdk\cmdline-tools\latest\bin\sdkmanager.bat" --sdk_root="$sdk" "platform-tools" "platforms;android-35" "build-tools;35.0.0"
   & "$sdk\cmdline-tools\latest\bin\sdkmanager.bat" --sdk_root="$sdk" --licenses
   ```

   La primera vez que se compila, Gradle descarga sus propias dependencias
   (unos cientos de MB).

### Compilar

```powershell
powershell -ExecutionPolicy Bypass -File .\compilar-apk.ps1
```

El script:

1. busca el JDK y el Android SDK;
2. compila `src/nativo.js` y arma `www/`;
3. crea la clave de firma si no existe;
4. ejecuta Gradle y deja **`dist\Mesa-y-Evento.apk`**.

Para una versión de prueba (firmada con la clave de depuración):

```powershell
powershell -ExecutionPolicy Bypass -File .\compilar-apk.ps1 -Debug
```

### Comandos sueltos

```powershell
npm run sync:www        # solo arma www/
npm run android:sync    # arma www/ y sincroniza el proyecto Android
npm run iconos          # regenera íconos y splash desde el dibujo de favicon.svg
npm run android:open    # abre el proyecto en Android Studio (si lo tenés)
```

---

## Cambiar el nombre o el identificador de la app

- `capacitor.config.json` → `appName` (nombre visible) y `appId`
  (identificador, por ejemplo `com.mesayevento.app`).
- Si cambiás `appId`, también hay que ajustar `applicationId` y `namespace` en
  `android/app/build.gradle` y el nombre del paquete en `MainActivity.java`.
- Después: `npm run android:sync`.

Cambiar el `appId` hace que Android la trate como **otra app**: no se actualiza encima
de la anterior y no comparte los datos guardados.

---

## Problemas frecuentes

- **“La app no está instalada”** al actualizar: el APK nuevo está firmado con otra clave.
  Conservá `keystore\mesa-y-evento.keystore` y `android\keystore.properties`.
- **No compila y dice que falta el SDK**: revisá que `ANDROID_HOME` apunte a la carpeta
  del SDK o que exista `%LOCALAPPDATA%\Android\Sdk\platforms\android-35`.
- **Gradle falla con la versión de Java**: tiene que ser JDK 21 (no 17 ni 24).
- **El texto se ve debajo de la barra de estado**: actualizá el WebView de Android desde
  Play Store; las versiones nuevas respetan los márgenes seguros que usa la app.
