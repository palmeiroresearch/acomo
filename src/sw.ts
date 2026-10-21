/**
 * Service worker.
 *
 * Dos estrategias, según lo que se pide:
 *
 * - **Datos** (`data/*.json`): red primero, caché como respaldo. Una tasa vieja
 *   es útil; una tasa vieja cuando había una nueva disponible, no.
 * - **Shell** (HTML, JS, CSS, iconos): caché primero. Los assets llevan hash en
 *   el nombre, así que son inmutables y servirlos desde caché es correcto y
 *   además instantáneo, que es lo que importa con conexiones lentas.
 *
 * La lista de precache la inyecta vite.config.ts en build, porque los nombres
 * con hash no se pueden escribir a mano.
 *
 * Correcciones respecto al sw.js anterior:
 * - El nombre del caché se deriva de la versión del build, no se escribe a mano
 *   (antes había que acordarse de subirlo o el caché viejo nunca se limpiaba).
 * - Un asset sin cachear y sin red devolvía `undefined` a `respondWith`, lo que
 *   el navegador traduce como error de red. Ahora se responde explícitamente.
 * - Hay fallback de navegación: cualquier ruta sin red sirve el index cacheado.
 */

/// <reference lib="webworker" />

declare const self: ServiceWorkerGlobalScope;

const CACHE = `acomo-v${__APP_VERSION__}`;

/** Sustituido en build por la lista real de ficheros emitidos. */
const PRECACHE: string[] = '__PRECACHE_MANIFEST__' as unknown as string[];

/** Datos: se piden siempre a la red primero. */
const DATA_PATTERN = /\/data\/[^/]+\.json$/;

self.addEventListener('install', (event) => {
    event.waitUntil((async () => {
        const cache = await self.caches.open(CACHE);
        // Uno por uno en vez de addAll: si un solo fichero falla, addAll
        // rechaza entero y la instalación se pierde completa.
        await Promise.all(PRECACHE.map((url) => cache.add(url).catch(() => undefined)));
    })());
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const names = await self.caches.keys();
        await Promise.all(names.filter((name) => name !== CACHE).map((name) => self.caches.delete(name)));
        await self.clients.claim();
    })());
});

async function networkFirst(request: Request): Promise<Response> {
    const cache = await self.caches.open(CACHE);
    try {
        const response = await fetch(request);
        if (response.ok) void cache.put(request, response.clone());
        return response;
    } catch {
        const cached = await cache.match(request);
        if (cached) return cached;
        return new Response(
            JSON.stringify({ error: 'offline' }),
            { status: 503, headers: { 'Content-Type': 'application/json' } },
        );
    }
}

async function cacheFirst(request: Request): Promise<Response> {
    const cache = await self.caches.open(CACHE);

    const cached = await cache.match(request);
    if (cached) return cached;

    try {
        const response = await fetch(request);
        if (response.ok) void cache.put(request, response.clone());
        return response;
    } catch {
        // Navegación sin red: se sirve la shell y la app se encarga de mostrar
        // los datos cacheados y el aviso de «sin conexión».
        if (request.mode === 'navigate') {
            const shell = await cache.match('./index.html') ?? await cache.match('./');
            if (shell) return shell;
        }
        return new Response('', { status: 503, statusText: 'Sin conexión' });
    }
}

self.addEventListener('fetch', (event) => {
    const { request } = event;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);
    // Las peticiones a otros orígenes (p. ej. el manifiesto OTA desde el
    // WebView) se dejan pasar sin interceptar.
    if (url.origin !== self.location.origin) return;

    event.respondWith(
        DATA_PATTERN.test(url.pathname) ? networkFirst(request) : cacheFirst(request),
    );
});

self.addEventListener('message', (event) => {
    if ((event.data as { type?: string } | null)?.type === 'SKIP_WAITING') {
        void self.skipWaiting();
    }
});
