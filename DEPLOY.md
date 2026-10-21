# Despliegue

## Web (GitHub Pages)

Automático. Cada push a `main` dispara `deploy.yml`, que compila, empaqueta el
bundle OTA y publica `dist/` en Pages.

### Configuración inicial del repo

1. **Settings → Pages → Source: GitHub Actions.**
2. **Settings → Pages → Custom domain:** `acomo.palmeiromed.com`, y marcar
   *Enforce HTTPS* una vez que el certificado se emita.
3. En el DNS de `palmeiromed.com`, un `CNAME`:
   `acomo` → `<usuario>.github.io`
4. Crear la etiqueta `tasas` en Issues (la usan los workflows para agrupar sus
   avisos).

El fichero [`public/CNAME`](public/CNAME) ya lleva el dominio; Vite lo copia a
`dist/` en cada build, así que el dominio no se pierde al redesplegar.

### Secret opcional

`ELTOQUE_API_KEY` — si algún día elToque entrega una key, añadirla en
**Settings → Secrets and variables → Actions**. El proveedor `eltoque_api` pasa
a ser la fuente activa en la siguiente corrida, sin tocar código.

---

## APK de Android

### Requisitos

Ya presentes en esta máquina:

- JDK 21 en `JAVA_HOME` (`F:\JDK-21`). Ojo: `java -version` en la terminal
  reporta 1.8 porque el JRE viejo está antes en el `PATH`; Gradle usa
  `JAVA_HOME`, así que no estorba.
- Android SDK en `ANDROID_HOME` (`F:\Android_SDK`).

### Compilar

```bash
npm run build                  # genera dist/ — SIEMPRE antes de sincronizar
cd mobile
npx cap sync android           # copia dist/ dentro del proyecto nativo
cd android && ./gradlew assembleDebug
```

El APK queda en `mobile/android/app/build/outputs/apk/debug/`.

Para una release firmada, generar un keystore y configurarlo en
`android/app/build.gradle`. **El keystore no se versiona** (está en
`.gitignore`): si se pierde, no se puede publicar una actualización del APK
sobre la instalación existente.

### Qué comprobar en el APK

Lo primero, antes que nada: **que muestre tasas**. Si la pantalla sale vacía o
con datos solo del día de la compilación, significa que alguna URL remota quedó
relativa. Dentro del WebView la página se sirve desde `https://localhost`, así
que una ruta relativa busca el fichero en el propio teléfono y nunca sale a
internet. Todo recurso remoto debe pasar por `remote()` en
[`src/config.ts`](src/config.ts).

---

## Actualizaciones OTA

Dos mecanismos distintos y separados:

| Plataforma | Mecanismo | Disparador |
|---|---|---|
| Navegador / PWA | Service worker | Automático; banner de «Nueva versión» |
| APK | `@capgo/capacitor-updater` | Manual, desde Ajustes → Buscar actualización |

El OTA está configurado con `autoUpdate: false` y `statsUrl: ""`: no se usa el
servicio cloud de Capgo, el control de versiones es propio vía
`https://acomo.palmeiromed.com/ota/manifest.json`.

### Publicar una actualización OTA

1. Subir la versión en `package.json` (p. ej. `2.0.1`).
2. Subir también `versionName` en `mobile/android/app/build.gradle`, para que
   coincida.
3. Commit y push.

El deploy se encarga del resto: compila, genera `ota/bundles/2.0.1.zip` y su
`manifest.json` a partir del mismo `dist/` que publica, y lo sube junto al
sitio. Generarlos juntos es deliberado: así el `sha256` del manifiesto no puede
quedar desparejado del zip, que es el fallo clásico de hacerlo a mano.

Las apps instaladas lo verán en su próximo chequeo desde Ajustes. El bundle se
descarga, se deja preparado y se aplica **al reabrir la app**, no al instante.

Para probarlo en local sin desplegar:

```bash
npm run build && npm run ota:release
```

### Qué NO puede actualizar el OTA

Solo contenido web (HTML, CSS, JS, datos). Cambiar un plugin nativo, los
permisos, el icono o el `minSdk` exige un APK nuevo.

---

## Si algo falla

| Síntoma | Causa probable |
|---|---|
| La web no actualiza las tasas | `rates.yml` falla. Revisar Issues con la etiqueta `tasas`. |
| Las tasas quedan congeladas pero sin issue | El cron se desactivó. GitHub los apaga tras 60 días sin actividad en el repo; se reactiva desde la pestaña Actions. |
| Pages sirve datos viejos | `deploy.yml` no corrió. Los commits de tasas **no** llevan `[skip ci]` justamente para que dispare. |
| El APK no muestra tasas | Una URL remota quedó relativa. Ver arriba. |
| El OTA no detecta la versión | `package.json` y `manifest.json` discrepan, o el `sha256` no cuadra. |
| Un parser devuelve `parse_failed` | La fuente cambió de formato. Regenerar fixtures y ajustar el parser. |
