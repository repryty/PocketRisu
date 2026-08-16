import { writable } from 'svelte/store'

/**
 * Renderer compatibility switch.
 *
 * This intentionally lives outside Database/character data.  It is an
 * app-local escape hatch, so importing or exporting a bot can never change
 * the renderer selected by another Risu-compatible client.
 */
export const LEGACY_BACKGROUND_RENDERER_KEY = 'risu-legacy-background-renderer'

function readLegacyBackgroundRenderer(): boolean {
    try {
        return globalThis.localStorage?.getItem(LEGACY_BACKGROUND_RENDERER_KEY) === '1'
    } catch {
        return false
    }
}

export const legacyBackgroundRenderer = writable(readLegacyBackgroundRenderer())

export function setLegacyBackgroundRenderer(enabled: boolean) {
    try {
        if (enabled) {
            globalThis.localStorage?.setItem(LEGACY_BACKGROUND_RENDERER_KEY, '1')
        } else {
            globalThis.localStorage?.removeItem(LEGACY_BACKGROUND_RENDERER_KEY)
        }
    } catch {
        // Private-mode browsers and storage-disabled environments are allowed.
    }
    legacyBackgroundRenderer.set(enabled)
}
