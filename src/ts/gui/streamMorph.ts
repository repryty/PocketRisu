// Incremental DOM update for a streaming chat message.
//
// `{@html}` replaces every node on each update, so elements with an entrance
// animation replay it on every streamed chunk, and the whole body flashes.
// `morphHtml` instead diffs the new HTML against the live DOM by position:
// nodes that did not change are left alone (their animations do not restart),
// changed text/attributes are patched in place, and only nodes that are new
// get inserted, with an optional fade-in.
//
// Attributes are tracked per element as last written from the source HTML, so
// changes made later by other code (asset resolution rewriting <img src>,
// added classes) survive until the source value itself changes. Inlay
// placeholders replaced by their resolved media are kept as well.

const FADE_MS = 320
const NO_WRAP_PARENTS = new Set([
    'STYLE', 'SCRIPT', 'TEXTAREA', 'TITLE', 'TABLE', 'THEAD', 'TBODY', 'TFOOT',
    'TR', 'COLGROUP', 'SELECT', 'OPTGROUP', 'DATALIST', 'OPTION', 'svg', 'SVG',
])

/** Attributes as last applied from the source HTML, per element. */
const applied = new WeakMap<Element, Map<string, string>>()
/** Spans this module added around new text so the text can fade in. */
const fadeWrappers = new WeakSet<Element>()
/** Elements this module created (anything else in the tree came from elsewhere). */
const owned = new WeakSet<Element>()

function reducedMotion(): boolean {
    try {
        return window.matchMedia('(prefers-reduced-motion: reduce)').matches
    } catch {
        return false
    }
}

function fade(el: Element) {
    try {
        (el as HTMLElement).animate?.(
            [{ opacity: 0 }, { opacity: 1 }],
            { duration: FADE_MS, easing: 'ease-out' },
        )
    } catch {
        // ignore: WAAPI unavailable
    }
}

function adopt(node: Node): Node {
    // Record attributes of a freshly inserted subtree so later diffs know
    // which values came from the source HTML.
    if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as Element
        owned.add(el)
        const attrs = new Map<string, string>()
        for (const a of Array.from(el.attributes)) attrs.set(a.name, a.value)
        applied.set(el, attrs)
        for (const child of Array.from(el.childNodes)) adopt(child)
    }
    return node
}

function insertNew(parent: Node, node: Node, before: Node | null, animate: boolean) {
    const imported = adopt(document.importNode(node, true))
    if (animate) {
        if (imported.nodeType === Node.ELEMENT_NODE) {
            parent.insertBefore(imported, before)
            fade(imported as Element)
            return
        }
        if (
            imported.nodeType === Node.TEXT_NODE &&
            imported.nodeValue?.trim() &&
            !NO_WRAP_PARENTS.has((parent as Element).nodeName)
        ) {
            const span = document.createElement('span')
            span.setAttribute('data-risu-fade', '')
            fadeWrappers.add(span)
            span.appendChild(imported)
            parent.insertBefore(span, before)
            fade(span)
            return
        }
    }
    parent.insertBefore(imported, before)
}

function syncAttributes(el: Element, source: Element) {
    let prev = applied.get(el)
    if (!prev) {
        prev = new Map()
        applied.set(el, prev)
    }
    const seen = new Set<string>()
    for (const a of Array.from(source.attributes)) {
        seen.add(a.name)
        if (prev.get(a.name) !== a.value || !el.hasAttribute(a.name)) {
            if (el.getAttribute(a.name) !== a.value) el.setAttribute(a.name, a.value)
            prev.set(a.name, a.value)
        }
    }
    for (const name of Array.from(prev.keys())) {
        if (!seen.has(name)) {
            el.removeAttribute(name)
            prev.delete(name)
        }
    }
}

function isFadeWrapper(node: Node | null): node is HTMLElement {
    return !!node && node.nodeType === Node.ELEMENT_NODE && fadeWrappers.has(node as Element)
}

function morphChildren(target: Node, source: Node, animate: boolean) {
    const next = Array.from(source.childNodes)
    let cursor: Node | null = target.firstChild

    for (const src of next) {
        const cur = cursor
        if (!cur) {
            insertNew(target, src, null, animate)
            continue
        }
        cursor = cur.nextSibling

        if (src.nodeType === Node.TEXT_NODE) {
            if (cur.nodeType === Node.TEXT_NODE) {
                if (cur.nodeValue !== src.nodeValue) cur.nodeValue = src.nodeValue
                continue
            }
            if (isFadeWrapper(cur)) {
                if (cur.textContent !== src.nodeValue) cur.textContent = src.nodeValue
                continue
            }
        }
        else if (src.nodeType === Node.ELEMENT_NODE && cur.nodeType === Node.ELEMENT_NODE) {
            const srcEl = src as Element
            const curEl = cur as Element
            // An inlay placeholder that was swapped for its media by the resolver.
            if (srcEl.hasAttribute('data-inlay-id') && !owned.has(curEl)) {
                continue
            }
            if (curEl.nodeName === srcEl.nodeName && !fadeWrappers.has(curEl)) {
                syncAttributes(curEl, srcEl)
                morphChildren(curEl, srcEl, animate)
                continue
            }
        }
        else if (src.nodeType === cur.nodeType && src.nodeType === Node.COMMENT_NODE) {
            if (cur.nodeValue !== src.nodeValue) cur.nodeValue = src.nodeValue
            continue
        }

        // Different kind of node at this position: replace it.
        insertNew(target, src, cur, animate)
        target.removeChild(cur)
    }

    while (cursor) {
        const rm = cursor
        cursor = cursor.nextSibling
        target.removeChild(rm)
    }
}

/**
 * Update `container`'s children to match `html`, touching only what changed.
 * New nodes fade in when `animate` is true (and reduced motion is off).
 */
export function morphHtml(container: HTMLElement, html: string, animate: boolean) {
    const template = document.createElement('template')
    template.innerHTML = html
    morphChildren(container, template.content, animate && !reducedMotion())
}
