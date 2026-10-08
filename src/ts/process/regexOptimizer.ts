const structuredStatusSource = String.raw`\[ (.*?) \| Course: (.*?) \| Tentacle: (.*?) \| Customer: (.*?)(?: \| 방문: (\d+)번째)? \| 쾌락도: (\d+)% \| 정신도: (\d+)% \| 임신도: (\d+)% \| 타락도: (\d+)% \| 절정: (\d+)회 \| 신체: (.*?) \| (.*?) \]`

const singleLineCharacter = String.raw`[^\r\n\u2028\u2029]`

function captureUntil(delimiter: string) {
    return `((?:(?!${delimiter})${singleLineCharacter})*)`
}

// Customer text may itself contain a delimiter-looking fragment. Only stop at
// a status boundary when every fixed field after it can complete, matching the
// original lazy wildcard's backtracking behavior.
const structuredMetricsSuffixValidation =
    String.raw`(?: \| 방문: \d+번째)? \| 쾌락도: \d+% \| 정신도: \d+% \| 임신도: \d+% \| 타락도: \d+% \| 절정: \d+회 \| 신체: ` +
    `${singleLineCharacter}*?` +
    String.raw` \| ` +
    `${singleLineCharacter}*?` +
    String.raw` \]`

const structuredStatusOptimizedSource =
    String.raw`\[ ` +
    captureUntil(String.raw` \| Course: `) +
    String.raw` \| Course: ` +
    captureUntil(String.raw` \| Tentacle: `) +
    String.raw` \| Tentacle: ` +
    captureUntil(String.raw` \| Customer: `) +
    String.raw` \| Customer: ` +
    captureUntil(structuredMetricsSuffixValidation) +
    String.raw`(?: \| 방문: (\d+)번째)? \| 쾌락도: (\d+)% \| 정신도: (\d+)% \| 임신도: (\d+)% \| 타락도: (\d+)% \| 절정: (\d+)회 \| 신체: ` +
    captureUntil(String.raw` \| `) +
    String.raw` \| ` +
    captureUntil(String.raw` \]`) +
    String.raw` \]`

const knownOptimizations = new Map<string, string>([
    [structuredStatusSource, structuredStatusOptimizedSource],
])

/**
 * Rewrites only regexes whose complete source has a reviewed equivalent.
 * Everything else remains byte-for-byte unchanged.
 */
export function optimizeRegexSource(
    source: string,
    flags: string,
    enabled = true,
): string {
    if (!enabled) {
        return source
    }

    // This scanner deliberately preserves dot's single-line semantics.
    if (flags.includes('s')) {
        return source
    }

    return knownOptimizations.get(source) ?? source
}
