const MAX_CACHE_ENTRIES = 1000
// Count UTF-16 code units as a cheap upper bound. In practice this keeps the
// retained input/result strings to roughly 16 MiB or less.
const MAX_CACHE_CHARS = 8 * 1024 * 1024

type CacheEntry = {
    signature: string
    data: string
    size: number
}

const cache = new Map<string, Map<string, string>>()
const insertionOrder = new Map<number, CacheEntry>()
let nextEntryId = 0
let cacheEntries = 0
let cacheChars = 0

function evictOldestEntry() {
    const oldest = insertionOrder.entries().next().value as [number, CacheEntry] | undefined
    if (!oldest) return

    const [entryId, entry] = oldest
    insertionOrder.delete(entryId)

    const bucket = cache.get(entry.signature)
    if (!bucket?.delete(entry.data)) return

    cacheEntries--
    cacheChars -= entry.size
    if (bucket.size === 0) cache.delete(entry.signature)
}

/**
 * Cache the deterministic part of regex display scripts.
 *
 * The higher-level script cache must be cleared when render/CBS state changes,
 * but String.replace itself depends only on these four values. Keeping this
 * small cache across GUI reloads avoids repeating expensive user regexes when
 * switching characters, greetings, or chat views.
 */
export function cachedRegexReplace(data: string, regex: RegExp, replacement: string) {
    const signature = `${regex.source.length}:${regex.source}${regex.flags.length}:${regex.flags}${regex.lastIndex}:${replacement.length}:${replacement}`
    const bucket = cache.get(signature)
    if (bucket?.has(data)) return bucket.get(data)!

    const result = data.replace(regex, replacement)
    const entrySize = signature.length + data.length + result.length
    if (entrySize > MAX_CACHE_CHARS) return result

    const targetBucket = bucket ?? new Map<string, string>()
    if (!bucket) cache.set(signature, targetBucket)
    targetBucket.set(data, result)
    insertionOrder.set(nextEntryId++, { signature, data, size: entrySize })
    cacheEntries++
    cacheChars += entrySize

    while (cacheEntries > MAX_CACHE_ENTRIES || cacheChars > MAX_CACHE_CHARS) {
        evictOldestEntry()
    }

    return result
}

export function clearRegexReplaceCache() {
    cache.clear()
    insertionOrder.clear()
    cacheEntries = 0
    cacheChars = 0
}
