/**
 * Globales inyectadas en build. Se declaran aquí, aparte de `vite-env.d.ts`,
 * porque el service worker también las necesita y se compila con otro tsconfig
 * (lib WebWorker en vez de DOM, ver tsconfig.sw.json).
 */

/** Versión tomada de package.json por vite.config.ts. */
declare const __APP_VERSION__: string;
