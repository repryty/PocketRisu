import { describe, expect, it } from 'vitest'
import { optimizeRegexSource } from './regexOptimizer'

const structuredStatusSource = String.raw`\[ (.*?) \| Course: (.*?) \| Tentacle: (.*?) \| Customer: (.*?)(?: \| 방문: (\d+)번째)? \| 쾌락도: (\d+)% \| 정신도: (\d+)% \| 임신도: (\d+)% \| 타락도: (\d+)% \| 절정: (\d+)회 \| 신체: (.*?) \| (.*?) \]`

function compareOriginalAndOptimized(input: string) {
    const optimizedSource = optimizeRegexSource(structuredStatusSource, 'g')
    const originalMatches = Array.from(
        input.matchAll(new RegExp(structuredStatusSource, 'g')),
        (match) => Array.from(match),
    )
    const optimizedMatches = Array.from(
        input.matchAll(new RegExp(optimizedSource, 'g')),
        (match) => Array.from(match),
    )
    const replacement = '$12::$1::$5::$4::$11'

    expect(optimizedMatches).toEqual(originalMatches)
    expect(input.replace(new RegExp(optimizedSource, 'g'), replacement)).toBe(
        input.replace(new RegExp(structuredStatusSource, 'g'), replacement),
    )
}

describe('optimizeRegexSource', () => {
    it('rewrites the reviewed structured-status pattern', () => {
        expect(optimizeRegexSource(structuredStatusSource, 'g')).not.toBe(
            structuredStatusSource,
        )
    })

    it('leaves unknown lazy wildcard patterns unchanged', () => {
        const source = String.raw`prefix: (.*?) \| suffix: (.*?)`

        expect(optimizeRegexSource(source, 'g')).toBe(source)
    })

    it('leaves reviewed patterns unchanged when optimization is disabled', () => {
        expect(optimizeRegexSource(structuredStatusSource, 'g', false)).toBe(
            structuredStatusSource,
        )
    })

    it('falls back when dotAll would change the scanner semantics', () => {
        expect(optimizeRegexSource(structuredStatusSource, 'gs')).toBe(
            structuredStatusSource,
        )
    })

    it('preserves matches and replacement groups for representative inputs', () => {
        const withVisit =
            '[ A | Course: B | Tentacle: C | Customer: D | 방문: 12번째 | 쾌락도: 1% | 정신도: 2% | 임신도: 3% | 타락도: 4% | 절정: 5회 | 신체: F | G ]'
        const withoutVisit =
            '[  | Course:  | Tentacle:  | Customer: D | 쾌락도: 0% | 정신도: 0% | 임신도: 0% | 타락도: 0% | 절정: 0회 | 신체:  |  ]'
        const malformedVisit =
            '[ A | Course: B | Tentacle: C | Customer: D | 방문: X번째 | 쾌락도: 1% | 정신도: 2% | 임신도: 3% | 타락도: 4% | 절정: 5회 | 신체: F | G ]'
        const falseNumericBoundary =
            '[ A | Course: B | Tentacle: C | Customer: D | 쾌락도: unknown | 쾌락도: 1% | 정신도: 2% | 임신도: 3% | 타락도: 4% | 절정: 5회 | 신체: F | G ]'
        const repeated = `before ${withVisit} middle ${withoutVisit} after`

        for (const input of [withVisit, withoutVisit, malformedVisit, falseNumericBoundary, repeated]) {
            compareOriginalAndOptimized(input)
        }
    })

    it('preserves dot behavior at every JavaScript line terminator', () => {
        for (const lineTerminator of ['\n', '\r', '\u2028', '\u2029']) {
            compareOriginalAndOptimized(
                `[ A${lineTerminator}B | Course: C | Tentacle: D | Customer: E | 쾌락도: 1% | 정신도: 2% | 임신도: 3% | 타락도: 4% | 절정: 5회 | 신체: F | G ]`,
            )
        }
    })
})
