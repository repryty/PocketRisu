import { getDatabase } from "./storage/database.svelte"
import { readImage } from "./globalApi.svelte"
import { requestChatData } from "./process/request/request"
import { defaultPersonaDescribePrompt } from "./storage/defaultPrompts"
import { saveUserPersona } from "./persona"

function sniffImageMime(data: Uint8Array): string {
    if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) return 'image/png'
    if (data[0] === 0xff && data[1] === 0xd8) return 'image/jpeg'
    if (data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46) return 'image/gif'
    if (data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46
        && data[8] === 0x57 && data[9] === 0x45 && data[10] === 0x42 && data[11] === 0x50) return 'image/webp'
    return 'image/png'
}

export interface PersonaSheetResult {
    ok: boolean
    text?: string
    reason?: 'noImage' | 'fail'
    error?: string
}

/**
 * Sends the selected persona's image plus `db.personaDescribePrompt` to the
 * main model and returns the generated character sheet text.
 */
export async function generatePersonaSheet(abortSignal?: AbortSignal): Promise<PersonaSheetResult> {
    const db = getDatabase()
    if (!db.userIcon) return { ok: false, reason: 'noImage' }
    const bytes = await readImage(db.userIcon)
    if (!bytes || bytes.length === 0) return { ok: false, reason: 'noImage' }

    const userName = db.username || 'User'
    const prompt = (db.personaDescribePrompt?.trim() ? db.personaDescribePrompt : defaultPersonaDescribePrompt)
        .replace(/\{\{user\}\}|<user>/gi, userName)
    const base64 = `data:${sniffImageMime(bytes)};base64,${Buffer.from(bytes).toString('base64')}`

    const rq = await requestChatData({
        formated: [{
            role: 'user',
            content: prompt,
            multimodals: [{ type: 'image', base64 }],
        }],
        bias: {},
        useStreaming: false,
        noMultiGen: true,
    }, 'model', abortSignal)

    if (rq.type === 'fail') return { ok: false, reason: 'fail', error: rq.result }
    if (rq.type !== 'success') return { ok: false, reason: 'fail', error: 'Unexpected response type' }

    const text = rq.result
        .replace(/<Thoughts>[\s\S]*?<\/Thoughts>/g, '')
        .replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/g, '')
        .trim()
    if (!text) return { ok: false, reason: 'fail', error: 'Empty response' }
    return { ok: true, text }
}

/** Writes a generated sheet into the selected persona's description. */
export function applyPersonaSheet(text: string) {
    const db = getDatabase()
    db.personaPrompt = text
    saveUserPersona()
}
