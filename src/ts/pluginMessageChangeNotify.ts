// Plays a notification sound when a plugin changes chat message content.
//
// Two kinds of call sites report here:
//   - in-pipeline hooks (editoutput/editinput script handlers, afterRequest
//     replacers) that returned a different text than they were given;
//   - plugin write APIs (setChar, setChatToIndex, setDatabase...) whose write
//     changed the open chat's messages (see `withPluginMessageWatch`).
//
// A report made while a generation is running is held until the generation
// ends, so a plugin rewriting every streamed chunk still rings only once.

import { get, type Unsubscriber } from 'svelte/store'
import { doingChat } from './process/generationState'
import { DBState, selectedCharID } from './stores.svelte'
import { playNotificationSound } from './notificationSound'

const SETTLE_DELAY_MS = 600

let pending = false
let timer: ReturnType<typeof setTimeout> | null = null
let doingChatUnsub: Unsubscriber | null = null

function enabled(): boolean {
    return DBState.db?.playPluginEditSound === true
}

function schedule() {
    if (get(doingChat)) {
        if (!doingChatUnsub) {
            doingChatUnsub = doingChat.subscribe((running) => {
                if (running) return
                // Unsubscribing synchronously inside the first (immediate)
                // callback would run before `doingChatUnsub` is assigned.
                queueMicrotask(() => {
                    doingChatUnsub?.()
                    doingChatUnsub = null
                    schedule()
                })
            })
        }
        return
    }
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
        timer = null
        if (!pending) return
        pending = false
        if (!enabled()) return
        void playNotificationSound(DBState.db.pluginEditSound, DBState.db.pluginEditSoundVolume)
    }, SETTLE_DELAY_MS)
}

/** Report that a plugin changed message content. Debounced; deferred while generating. */
export function reportPluginMessageChange() {
    if (!enabled()) return
    pending = true
    schedule()
}

function openChatFingerprint(): { id: string, body: string } {
    try {
        const char = DBState.db?.characters?.[get(selectedCharID)]
        const chat = char?.chats?.[char.chatPage]
        const messages = chat?.message
        if (!Array.isArray(messages)) return { id: '', body: '' }
        let body = String(messages.length)
        for (const m of messages) {
            body += `\u0001${m?.chatId ?? ''}\u0000${m?.data ?? ''}`
        }
        return { id: `${char.chaId}\u0002${chat.id ?? ''}`, body }
    } catch {
        return { id: '', body: '' }
    }
}

/**
 * Run a plugin write API and report when it changed the open chat's messages.
 * Writes that only touch other fields (character settings, other chats) stay silent.
 */
export function withPluginMessageWatch<T>(write: () => T): T {
    if (!enabled()) return write()
    const before = openChatFingerprint()
    const check = () => {
        const after = openChatFingerprint()
        // Switching to another chat/character is not a message edit.
        if (before.id !== '' && before.id === after.id && before.body !== after.body) {
            reportPluginMessageChange()
        }
    }
    const result = write()
    if (result instanceof Promise) {
        return result.finally(check) as T
    }
    check()
    return result
}
