import { beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'

let DBState = $state({ db: {} as any })
let hotReloading = $state([] as string[])
let pluginAlertModalStore = $state({ open: false, errors: [] as any[] })
const selectedCharID = writable(0)

vi.doMock('../storage/database.svelte', () => ({
    getDatabase: () => DBState.db,
    getCurrentCharacter: () => undefined,
    setDatabase: () => {},
    setDatabaseLite: () => {},
}))

vi.doMock('../stores.svelte', () => ({
    DBState,
    selectedCharID,
    hotReloading,
    pluginAlertModalStore,
}))

vi.mock('../../lang', () => ({ language: {} }))
vi.mock('../alert', () => ({
    alertConfirm: async () => true,
    alertError: () => {},
    alertPluginConfirm: async () => true,
}))
vi.mock('../util', () => ({
    selectSingleFile: async () => null,
    sleep: async () => {},
}))
vi.mock('../globalApi.svelte', () => ({
    fetchNative: () => {},
    globalFetch: () => {},
    readImage: () => {},
    requestImmediateSave: () => {},
    saveAsset: () => {},
    toGetter: (getter: () => unknown) => getter(),
}))
vi.mock('./pluginSafety', () => ({ checkCodeSafety: () => ({}) }))
vi.mock('./pluginSafeClass', () => ({
    SafeDocument: class {},
    SafeIdbFactory: class {},
    SafeLocalStorage: class {},
}))
vi.mock('./apiV3/v3.svelte', () => ({ loadV3Plugins: async () => {} }))
vi.mock('./apiV3/transpiler', () => ({ pluginCodeTranspiler: (code: string) => code }))

const { getV2PluginAPIs } = await import('./plugins.svelte')

let unrelatedReads = 0

beforeEach(() => {
    unrelatedReads = 0

    const unrelated = {}
    Object.defineProperty(unrelated, 'expensive', {
        enumerable: true,
        get() {
            unrelatedReads += 1
            return 'must not be snapshotted'
        },
    })

    DBState.db = {
        pluginCustomStorage: {
            target: { nested: { value: 1 } },
            empty: '',
        },
        unrelated,
    }

    unrelatedReads = 0
})

describe('pluginStorage.getItem', () => {
    test('snapshots only the requested value', () => {
        const value = getV2PluginAPIs().pluginStorage.getItem('target') as any

        expect(value).toEqual({ nested: { value: 1 } })
        expect(unrelatedReads).toBe(0)
        expect(value).not.toBe(DBState.db.pluginCustomStorage.target)

        value.nested.value = 2
        expect(DBState.db.pluginCustomStorage.target.nested.value).toBe(1)
    })

    test('preserves legacy null results for missing and falsy values', () => {
        const storage = getV2PluginAPIs().pluginStorage

        expect(storage.getItem('missing')).toBeNull()
        expect(storage.getItem('empty')).toBeNull()
        expect(unrelatedReads).toBe(0)
    })
})
