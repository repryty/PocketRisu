import { beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'

let DBState = $state({ db: {} as any })
const selectedCharID = writable(0)
const selIdState = { selId: 0 }

vi.doMock('../stores.svelte', () => ({
    DBState,
    selectedCharID,
    selIdState,
}))

vi.mock('../globalApi.svelte', () => ({
    forageStorage: { realStorage: null },
    downloadFile: () => {},
    saveAsset: () => Promise.resolve(''),
}))

vi.mock('../alert', () => ({
    notifySuccess: () => {},
    alertError: () => {},
}))

vi.mock('../../lang', () => ({
    language: {},
    changeLanguage: () => {},
}))

const { getCurrentCharacter, getCharacterByIndex } = await import('./database.svelte')

let unrelatedReads = 0

beforeEach(() => {
    selectedCharID.set(0)
    unrelatedReads = 0

    const unrelated = {}
    Object.defineProperty(unrelated, 'expensive', {
        enumerable: true,
        get() {
            unrelatedReads += 1
            return { payload: 'must not be snapshotted' }
        },
    })

    DBState.db = {
        characters: [
            {
                chaId: 'char-a',
                name: 'A',
                chatPage: 0,
                chats: [{ id: 'chat-a', message: [{ role: 'user', data: 'hello' }] }],
            },
            {
                chaId: 'char-b',
                name: 'B',
                chatPage: 0,
                chats: [{ id: 'chat-b', message: [] }],
            },
        ],
        unrelated,
    }

    // Ignore any reads performed while Svelte wraps the test fixture.
    unrelatedReads = 0
})

describe('character snapshots', () => {
    test('getCurrentCharacter snapshots only the selected character', () => {
        const result = getCurrentCharacter({ snapshot: true })

        expect(result).toEqual({
            chaId: 'char-a',
            name: 'A',
            chatPage: 0,
            chats: [{ id: 'chat-a', message: [{ role: 'user', data: 'hello' }] }],
        })
        expect(unrelatedReads).toBe(0)
        expect(result).not.toBe(DBState.db.characters[0])

        result.chats[0].message[0].data = 'plugin mutation'
        expect(DBState.db.characters[0].chats[0].message[0].data).toBe('hello')
    })

    test('getCharacterByIndex snapshots only the requested character', () => {
        const result = getCharacterByIndex(1, { snapshot: true })

        expect(result.name).toBe('B')
        expect(unrelatedReads).toBe(0)
        expect(result).not.toBe(DBState.db.characters[1])
    })
})
