import type { Chat, character } from '../storage/database.svelte'
import type { RisuModule } from './modules'

/**
 * Runtime-only information for a render operation.
 *
 * Character cards and module exports never contain this object. Keeping the
 * target explicit prevents background rendering from accidentally falling
 * back to the globally selected chat after an async boundary.
 */
export interface RenderContext {
    target: 'message' | 'background'
    character?: character
    chat?: Chat
    modules?: RisuModule[]
    messageIndex?: number
}
