# A Cómo

Tasas de cambio de Cuba —mercado informal y Segmento III del Banco Central— con
calculadora. PWA instalable y APK de Android, pensada para funcionar con mala
conexión o sin ninguna.

**Producción:** https://acomo.palmeiromed.com

---

## Por qué este proyecto se reconstruyó

La versión anterior scrapeaba `eltoque.com` desde un GitHub Action. **Nunca
funcionó.** eltoque.com está detrás de Cloudflare y devuelve `HTTP 403` con la
página «Just a moment…» a cualquier cliente que no sea un navegador real, así
que el `__NEXT_DATA__` que el script buscaba no existía en la respuesta. El
script moría en cada corrida y la app sirvió valores de relleno del 28/07/2026
durante meses, presentándolos como si fueran del día.

De ahí salen las dos reglas que gobiernan el diseño actual:

1. **Un dato viejo se muestra como viejo.** Cada bloque de tasas viaja con su
   `updated_at` y la UI dice «actualizado hace X», en ámbar pasadas 6 h y en
   rojo pasadas 24 h.
2. **Un fallo tiene que ser ruidoso.** Cada corrida publica en `rates.json` qué
   fuentes se intentaron y por qué fallaron, y el workflow abre un issue si la
   cadena entera se cae.

---

## Fuentes de datos

### Mercado informal

**cubadivisas.com**, y solo esa. Publica con los nombres de campo literales de
elToque (`ECU` para el euro, `USD_Zelle.CUP`, `median`), así que casi con
certeza consume su API con key propia: es lo más cercano al TRMI accesible sin
key.

Hubo una cadena de cuatro proveedores. Una corrida real en Actions demostró que
las otras tres no sirven desde un runner, y se eliminaron:

| Proveedor | Por qué se quitó |
|---|---|
| `eltoque_api` | Requiere una API key que elToque no entrega. |
| `eltoque_browser` | Chromium contra el reto de Cloudflare: nunca lo pasó. |
| `directoriocubano` | Responde desde una IP residencial, pero el datacenter de GitHub recibe el reto de Cloudflare. |

De ahí la lección que conviene no olvidar: **probar una fuente desde una máquina
doméstica no dice nada sobre si funcionará en CI.** La única prueba válida es la
corrida real. Mantener proveedores que siempre fallan solo añadía ruido al
registro de intentos y daba una falsa sensación de respaldo.

Con una sola fuente, lo que cubre el riesgo no es la redundancia sino la
detección: los tests contra HTML congelado y el chequeo semanal avisan por issue
el día que cambie de formato, y mientras tanto la app sigue sirviendo el último
valor bueno con su antigüedad a la vista.

> Las tasas informales **no son el TRMI de elToque** y la app nunca lo dice. La
> fuente real aparece nombrada en pantalla. Son referenciales.

### Oficial

`https://api.bc.gob.cu/v1/tasas-de-cambio/activas`, tomando `tasaEspecial`, que
es el Segmento III. El API no tiene CORS —devuelve 403 en cuanto la petición
lleva header `Origin`— y por eso hay que proxiarla a un JSON estático en vez de
llamarla desde el navegador.

---

## Desarrollo

Este ya **no** es un proyecto de HTML plano: `index.html` carga TypeScript, que
el navegador no entiende por sí solo. Abrirlo con Live Server muestra una página
en blanco. Usa:

```bash
npm install
npm run dev        # servidor de desarrollo, recarga en caliente
```

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo (sustituye a Live Server). |
| `npm run build` | Compila a `dist/`, que es lo que se publica. |
| `npm run preview` | Sirve `dist/` tal como lo verá GitHub Pages. |
| `npm test` | Tests del core (calculadora, conversión, formateo). |
| `npm run typecheck` | Comprueba tipos de la app y del service worker. |
| `npm run rates` | Actualiza las tasas en local. |
| `npm run rates:dry` | Resuelve las tasas e imprime, sin escribir nada. |
| `npm run ota:release` | Empaqueta el bundle OTA desde `dist/`. |

### Pipeline de tasas

```bash
pip install -r scripts/requirements.txt

python -m scripts.rates.main --dry-run     # resuelve e imprime, sin escribir
python -m pytest scripts/rates/tests       # parsers vs HTML congelado
```

Los tests corren contra fixtures congeladas, sin red. Son el detector de «una
fuente cambió de formato»: cuando fallen en CI, hay que regenerar las fixtures
con `python -m scripts.rates.tests.refresh_fixtures` y ajustar el parser —nunca
relajar el test.

---

## Estructura

```
src/core/      Lógica pura y testeada: calculadora, conversión, formateo
src/data/      Carga de tasas con caché en localStorage
src/ui/        Pantallas: tasas, calculadora, ajustes
src/ota/       Actualizaciones OTA de la app nativa
src/sw.ts      Service worker (se compila aparte, ver tsconfig.sw.json)
scripts/rates/ Pipeline de tasas en Python
mobile/        Envoltorio Capacitor para Android
public/data/   Artefactos que el Action actualiza
```

### Dónde está la configuración

Todas las URLs viven en [`src/config.ts`](src/config.ts). Cambiar de dominio es
cambiar `SITE_URL`.

**Cuidado con las rutas en la app nativa:** dentro del WebView la página se
sirve desde `https://localhost`, no desde el dominio real. Una ruta relativa
apuntaría al localhost del teléfono y la app se quedaría sin tasas para siempre,
sin error visible. Por eso todo recurso remoto pasa por `remote()` en
`config.ts`, que usa ruta absoluta en nativo.

---

## Automatización

| Workflow | Cuándo | Qué hace |
|---|---|---|
| `rates.yml` | Cada 30 min | Actualiza `public/data/`. Abre issue si falla. |
| `deploy.yml` | Push a `main` | Compila, empaqueta el OTA y publica en Pages. |
| `ci.yml` | Push y PR | Tipos, tests del core y tests de los parsers. |
| `sources-health.yml` | Lunes | Diagnostica la fuente y los parsers, sin publicar. |

Correr las tasas cada 30 minutos —también de noche— sale casi gratis: si la tasa
no cambió no hay commit, y sin commit no hay deploy. Es el mismo ritmo al que se
refresca la fuente.

### Cómo se entera la app

Tres momentos, sin que el usuario tenga que tocar nada:

- Al abrir la app o entrar en la pantalla de tasas.
- Al volver desde segundo plano (`visibilitychange`). En móvil es el caso
  principal: la app pasa horas suspendida.
- Al recuperar la conexión (`online`), y cada 5 minutos con la pantalla abierta.

Hay un suelo de 60 s entre peticiones y se omiten sin conexión. El coste en
datos es casi nulo: la petición va con `cache: 'no-cache'`, así que si el
fichero no cambió el servidor responde 304 sin cuerpo — importa con tarifas de
datos caras.

---

## Licencia y datos

Las tasas provienen de agregadores públicos de terceros y son **referenciales**.
No son una fuente oficial ni sirven como base para reclamaciones.
