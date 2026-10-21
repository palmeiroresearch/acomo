/**
 * Escritor de ZIP mínimo, sin dependencias.
 *
 * Se escribe a mano en vez de delegar en `tar` o `Compress-Archive` por tres
 * razones concretas:
 *
 * 1. El `tar` de Git Bash en Windows interpreta `F:/ruta` como un host remoto
 *    («Cannot connect to F: resolve failed») y además, al ser GNU tar, no sabe
 *    generar ZIP. El que sí sirve es el bsdtar de System32, pero el PATH de Git
 *    Bash no lo resuelve.
 * 2. `Compress-Archive` solo existe en Windows, y el bundle también se genera
 *    en el runner Linux del deploy.
 * 3. Determinismo: se fuerza una fecha fija en las entradas, así el mismo
 *    `dist` produce siempre el mismo sha256. Un zip con marcas de tiempo
 *    cambiantes daría un checksum distinto en cada corrida.
 */

import { deflateRawSync, crc32 as zlibCrc32 } from 'node:zlib';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/** Fecha fija (1980-01-01, el cero del formato) para que el zip sea reproducible. */
const DOS_TIME = 0;
const DOS_DATE = 0x21;

const crc32 = typeof zlibCrc32 === 'function'
    ? (buffer) => zlibCrc32(buffer) >>> 0
    : (() => {
        const table = Array.from({ length: 256 }, (_, n) => {
            let c = n;
            for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
            return c >>> 0;
        });
        return (buffer) => {
            let c = 0xffffffff;
            for (const byte of buffer) c = table[(c ^ byte) & 0xff] ^ (c >>> 8);
            return (c ^ 0xffffffff) >>> 0;
        };
    })();

/** Lista recursiva de ficheros de un directorio, en orden estable. */
export function walk(dir) {
    const found = [];

    const visit = (current) => {
        for (const name of readdirSync(current).sort()) {
            const full = join(current, name);
            if (statSync(full).isDirectory()) visit(full);
            else found.push(full);
        }
    };

    visit(dir);
    return found;
}

/**
 * Comprime el contenido de `dir` en un Buffer ZIP.
 * Las rutas quedan relativas a `dir`, sin carpeta contenedora: el plugin OTA
 * espera encontrar `index.html` en la raíz del zip.
 */
export function zipDirectory(dir) {
    const locals = [];
    const centrals = [];
    let offset = 0;

    for (const file of walk(dir)) {
        // Los ZIP usan siempre «/», también en Windows.
        const name = relative(dir, file).split(sep).join('/');
        const nameBytes = Buffer.from(name, 'utf8');

        const raw = readFileSync(file);
        const deflated = deflateRawSync(raw, { level: 9 });

        // Si comprimir no ayuda (imágenes PNG, por ejemplo), se guarda tal cual.
        const useDeflate = deflated.length < raw.length;
        const data = useDeflate ? deflated : raw;
        const method = useDeflate ? 8 : 0;
        const checksum = crc32(raw);

        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(0, 6);
        local.writeUInt16LE(method, 8);
        local.writeUInt16LE(DOS_TIME, 10);
        local.writeUInt16LE(DOS_DATE, 12);
        local.writeUInt32LE(checksum, 14);
        local.writeUInt32LE(data.length, 18);
        local.writeUInt32LE(raw.length, 22);
        local.writeUInt16LE(nameBytes.length, 26);
        local.writeUInt16LE(0, 28);

        locals.push(local, nameBytes, data);

        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0);
        central.writeUInt16LE(20, 4);
        central.writeUInt16LE(20, 6);
        central.writeUInt16LE(0, 8);
        central.writeUInt16LE(method, 10);
        central.writeUInt16LE(DOS_TIME, 12);
        central.writeUInt16LE(DOS_DATE, 14);
        central.writeUInt32LE(checksum, 16);
        central.writeUInt32LE(data.length, 20);
        central.writeUInt32LE(raw.length, 24);
        central.writeUInt16LE(nameBytes.length, 28);
        central.writeUInt16LE(0, 30);
        central.writeUInt16LE(0, 32);
        central.writeUInt16LE(0, 34);
        central.writeUInt16LE(0, 36);
        // Permisos Unix (0644) en los 16 bits altos. El `>>> 0` es necesario:
        // el desplazamiento se evalúa en 32 bits con signo y daría negativo.
        central.writeUInt32LE((0o100644 << 16) >>> 0, 38);
        central.writeUInt32LE(offset, 42);

        centrals.push(central, nameBytes);
        offset += local.length + nameBytes.length + data.length;
    }

    const centralBlock = Buffer.concat(centrals);
    const count = centrals.length / 2;

    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(0, 4);
    end.writeUInt16LE(0, 6);
    end.writeUInt16LE(count, 8);
    end.writeUInt16LE(count, 10);
    end.writeUInt32LE(centralBlock.length, 12);
    end.writeUInt32LE(offset, 16);
    end.writeUInt16LE(0, 20);

    return Buffer.concat([...locals, centralBlock, end]);
}
