import { readFileSync } from 'node:fs';

import { defineConfig, type Plugin } from 'vite';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

/**
 * Inyecta en el service worker la lista real de ficheros emitidos.
 *
 * Los assets llevan hash en el nombre, así que no se pueden escribir a mano en
 * el SW. Sin esta lista el precache no sería posible y la app solo funcionaría
 * offline a partir de la segunda visita — que con la conectividad de Cuba es
 * precisamente el caso que hay que cubrir.
 */
function injectPrecacheManifest(): Plugin {
    return {
        name: 'acomo:precache-manifest',
        apply: 'build',
        generateBundle(_options, bundle) {
            const swChunk = Object.values(bundle).find(
                (file) => file.type === 'chunk' && file.fileName === 'sw.js',
            );
            if (!swChunk || swChunk.type !== 'chunk') return;

            const assets = Object.keys(bundle)
                .filter((name) => name !== 'sw.js' && !name.endsWith('.map'))
                .map((name) => `./${name}`);

            // La raíz y el index se añaden a mano: no son ficheros del bundle
            // pero son lo que pide el navegador al abrir la app.
            const precache = ['./', './index.html', ...assets];

            // El placeholder se busca con regex y no como literal porque el
            // minificador reescribe las comillas a su gusto (convirtió las
            // dobles en backticks), y una sustitución literal fallaba en
            // silencio dejando un string donde el SW espera un array.
            const placeholder = /(['"`])__PRECACHE_MANIFEST__\1/;
            if (!placeholder.test(swChunk.code)) {
                this.error(
                    'No se encontró __PRECACHE_MANIFEST__ en sw.js. Sin la lista de '
                    + 'ficheros el modo offline no funcionaría, así que se aborta el build.',
                );
            }

            swChunk.code = swChunk.code.replace(placeholder, JSON.stringify(precache));
        },
    };
}

export default defineConfig({
    // Dominio propio en la raíz (acomo.palmeiromed.com), no un subdirectorio.
    base: '/',

    define: {
        __APP_VERSION__: JSON.stringify(pkg.version),
    },

    build: {
        target: 'es2022',
        rollupOptions: {
            input: {
                main: new URL('./index.html', import.meta.url).pathname,
                // El SW se compila como entrada aparte para que pueda usar
                // __APP_VERSION__ y el manifiesto de precache.
                sw: new URL('./src/sw.ts', import.meta.url).pathname,
            },
            output: {
                // El service worker debe quedar en la raíz y sin hash: su URL
                // es parte del contrato con el navegador y define su scope.
                entryFileNames: (chunk) =>
                    chunk.name === 'sw' ? 'sw.js' : 'assets/[name]-[hash].js',
                chunkFileNames: 'assets/[name]-[hash].js',
                assetFileNames: 'assets/[name]-[hash][extname]',
            },
        },
    },

    plugins: [injectPrecacheManifest()],
});
