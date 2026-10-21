/**
 * Ayudante mínimo para construir DOM.
 *
 * Sustituye el uso de `innerHTML` con interpolación de la versión anterior, que
 * inyectaba valores venidos de un JSON remoto directamente en HTML. Con una
 * sola fuente propia era un riesgo teórico; con cuatro fuentes scrapeadas de
 * sitios de terceros, no. Aquí todo texto entra como nodo de texto, así que no
 * hay forma de que un valor se interprete como marcado.
 */

type Attrs = Record<string, string | number | boolean | undefined>;
type Child = Node | string | number | false | null | undefined;

export function el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    attrs: Attrs = {},
    children: Child[] = [],
): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);

    for (const [name, value] of Object.entries(attrs)) {
        if (value === undefined || value === false) continue;
        if (name === 'class') node.className = String(value);
        else if (value === true) node.setAttribute(name, '');
        else node.setAttribute(name, String(value));
    }

    append(node, children);
    return node;
}

export function append(parent: Node, children: Child[]): void {
    for (const child of children) {
        if (child === null || child === undefined || child === false) continue;
        parent.appendChild(typeof child === 'object' ? child : document.createTextNode(String(child)));
    }
}

export function clear(node: Node): void {
    while (node.firstChild) node.removeChild(node.firstChild);
}

/** Reemplaza el contenido de un elemento en una sola operación. */
export function replace(parent: Element, children: Child[]): void {
    clear(parent);
    append(parent, children);
}

/** SVG inline a partir de los comandos de path, para los iconos. */
export function icon(paths: string[], size = 20, strokeWidth = 2): SVGSVGElement {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', String(strokeWidth));
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    // Decorativo: el nombre accesible lo da el aria-label del botón que lo contiene.
    svg.setAttribute('aria-hidden', 'true');

    for (const d of paths) {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', d);
        svg.appendChild(path);
    }
    return svg;
}

export const ICONS = {
    back: ['M15 18l-6-6 6-6'],
    refresh: ['M23 4v6h-6', 'M20.49 15a9 9 0 1 1-2.12-9.36L23 10'],
    settings: [
        'M12 15.5A3.5 3.5 0 1 0 12 8.5a3.5 3.5 0 0 0 0 7z',
        'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
    ],
    calculator: [
        'M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z',
        'M7 7h10', 'M7 12h2', 'M11 12h2', 'M15 12h2', 'M7 16h2', 'M11 16h2', 'M15 16h2',
    ],
    exchange: ['M12 1v22', 'M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6'],
    swap: ['M7 10l5-5 5 5', 'M7 14l5 5 5-5'],
} satisfies Record<string, string[]>;
