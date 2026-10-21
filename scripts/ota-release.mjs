/**
 * Empaqueta un bundle OTA y actualiza el manifiesto.
 *
 *     npm run build && npm run ota:release
 *
 * En PerCuba esto era manual —comprimir, calcular el sha256, editar el JSON a
 * mano— que es justo el tipo de paso donde se cuela un checksum desparejado y
 * la app rechaza la actualización sin decir por qué. Aquí se deriva todo de
 * `dist/` y de la versión de package.json.
 *
 * El bundle NO se versiona en git (ver .gitignore): es un artefacto de build.
 * El manifiesto sí, porque es lo que la app consulta.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { zipDirectory } from './zip.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(ROOT, 'dist');
const BUNDLES = join(ROOT, 'ota', 'bundles');

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const { version } = pkg;

const SITE_URL = 'https://acomo.palmeiromed.com';

function fail(message) {
    console.error(`\n  ${message}\n`);
    process.exit(1);
}

if (!existsSync(join(DIST, 'index.html'))) {
    fail('No hay dist/index.html. Ejecuta `npm run build` antes de `npm run ota:release`.');
}

mkdirSync(BUNDLES, { recursive: true });
const zipPath = join(BUNDLES, `${version}.zip`);

// El plugin espera un zip cuya raíz sea el contenido del sitio —index.html
// arriba del todo— no una carpeta `dist/` dentro.
const bytes = zipDirectory(DIST);
writeFileSync(zipPath, bytes);

const sha256 = createHash('sha256').update(bytes).digest('hex');

const manifest = {
    version,
    url: `${SITE_URL}/ota/bundles/${version}.zip`,
    sha256,
    sizeBytes: bytes.length,
    publishedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
};

writeFileSync(join(ROOT, 'ota', 'manifest.json'), `${JSON.stringify(manifest, null, 4)}\n`, 'utf8');

console.log(`
  Bundle OTA ${version} listo

    zip      ota/bundles/${version}.zip  (${(manifest.sizeBytes / 1024).toFixed(1)} kB)
    sha256   ${sha256.slice(0, 16)}…
    url      ${manifest.url}

  Siguiente paso: commit de ota/manifest.json y push. El deploy sube el zip
  junto al sitio, y las apps instaladas lo verán en su próximo chequeo.
`);
