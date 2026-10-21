/**
 * Actualizaciones OTA de la app nativa.
 *
 * Portado del `ota-updater.js` de PerCuba, que ya está probado en producción.
 * Se conserva lo esencial de su diseño:
 *
 * - **Solo actúa en nativo.** En el navegador el mecanismo equivalente es el
 *   service worker; son dos sistemas distintos y no deben mezclarse.
 * - **Best-effort absoluto.** Cualquier fallo de red o de manifiesto se ignora
 *   y la app sigue con el bundle que ya tiene. Nunca debe bloquear el arranque
 *   ni romper el funcionamiento offline.
 * - **Manifiesto propio**, sin el servicio cloud de Capgo (`autoUpdate: false`,
 *   `statsUrl: ""` en capacitor.config.json).
 * - **URL absoluta obligatoria**: dentro del WebView la página se sirve desde
 *   `https://localhost`, así que una ruta relativa nunca saldría a internet.
 *
 * Se añade sobre el original la verificación del checksum del bundle, que el
 * manifiesto ya traía pero no se comprobaba.
 */

import { APP_VERSION, OTA_MANIFEST_URL, isNative } from '../config';

const FETCH_TIMEOUT_MS = 8_000;

interface BundleInfo {
    id: string;
    version: string;
}

interface CapacitorUpdaterPlugin {
    notifyAppReady(): Promise<unknown>;
    current(): Promise<{ bundle?: BundleInfo }>;
    download(options: { version: string; url: string; checksum?: string }): Promise<BundleInfo>;
    next(options: { id: string }): Promise<unknown>;
}

interface Manifest {
    version: string;
    url: string;
    sha256?: string;
}

export type OtaResult =
    | { state: 'unsupported' }
    | { state: 'up-to-date'; running: string }
    | { state: 'staged'; running: string; latest: string }
    | { state: 'error'; running: string; reason: string };

function plugin(): CapacitorUpdaterPlugin | null {
    if (!isNative()) return null;
    const candidate = window.Capacitor?.Plugins?.['CapacitorUpdater'];
    return (candidate as CapacitorUpdaterPlugin | undefined) ?? null;
}

/** Compara versiones semánticas numéricas: ¿`remote` es posterior a `local`? */
export function isNewer(remote: string, local: string): boolean {
    const parse = (value: string) => String(value).split('.').map((part) => Number.parseInt(part, 10) || 0);
    const a = parse(remote);
    const b = parse(local);

    for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
        const left = a[i] ?? 0;
        const right = b[i] ?? 0;
        if (left > right) return true;
        if (left < right) return false;
    }
    return false;
}

async function fetchManifest(): Promise<Manifest | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
        const response = await fetch(OTA_MANIFEST_URL, {
            cache: 'no-store',
            signal: controller.signal,
        });
        if (!response.ok) return null;

        const manifest = (await response.json()) as Partial<Manifest>;
        if (!manifest?.version || !manifest.url) return null;

        return manifest as Manifest;
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Busca, descarga y deja lista una actualización.
 * Siempre resuelve: el estado describe qué pasó, para poder decírselo al usuario.
 */
export async function checkForUpdate(): Promise<OtaResult> {
    const updater = plugin();
    if (!updater) return { state: 'unsupported' };

    let running = APP_VERSION;

    try {
        const current = await updater.current();
        // `builtin` es el bundle que vino dentro del APK: ahí la versión real es
        // la compilada, no la del plugin.
        if (current.bundle && current.bundle.id !== 'builtin') {
            running = current.bundle.version;
        }

        const manifest = await fetchManifest();
        if (!manifest) return { state: 'error', running, reason: 'manifest' };

        if (!isNewer(manifest.version, running)) {
            return { state: 'up-to-date', running };
        }

        const bundle = await updater.download({
            version: manifest.version,
            url: manifest.url,
            ...(manifest.sha256 ? { checksum: manifest.sha256 } : {}),
        });
        await updater.next({ id: bundle.id });

        return { state: 'staged', running, latest: manifest.version };
    } catch (error) {
        const reason = error instanceof Error ? error.message : 'desconocido';
        return { state: 'error', running, reason };
    }
}

/**
 * Arranque del subsistema OTA. Llamar una vez, lo antes posible.
 *
 * `notifyAppReady()` tiene que ejecutarse ANTES de cualquier petición de red:
 * si no llega en unos 10 s, el plugin asume que el bundle nuevo está roto y
 * revierte al anterior. Ese orden no es un detalle de estilo.
 */
export function initOta(): void {
    const updater = plugin();
    if (!updater) return;

    void updater.notifyAppReady().catch(() => {});

    void checkForUpdate().then((result) => {
        if (result.state === 'staged') {
            console.info(`[OTA] Versión ${result.latest} descargada; se aplicará al reabrir la app.`);
        }
    });
}
