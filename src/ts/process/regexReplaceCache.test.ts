import { beforeEach, describe, expect, test } from 'vitest'
import { cachedRegexReplace, clearRegexReplaceCache } from './regexReplaceCache'

class CountingRegExp extends RegExp {
    replacements = 0

    override [Symbol.replace](value: string, replacement: string) {
        this.replacements++
        return super[Symbol.replace](value, replacement)
    }
}

describe('cachedRegexReplace', () => {
    beforeEach(() => clearRegexReplaceCache())

    test('reuses a replacement for the same regex, input, and replacement', () => {
        const first = new CountingRegExp('a+', 'g')
        const second = new CountingRegExp('a+', 'g')

        expect(cachedRegexReplace('caaab', first, 'x')).toBe('cxb')
        expect(cachedRegexReplace('caaab', second, 'x')).toBe('cxb')
        expect(first.replacements).toBe(1)
        expect(second.replacements).toBe(0)
    })

    test('keeps empty-string results as valid cache entries', () => {
        const first = new CountingRegExp('.+', 'g')
        const second = new CountingRegExp('.+', 'g')

        expect(cachedRegexReplace('remove me', first, '')).toBe('')
        expect(cachedRegexReplace('remove me', second, '')).toBe('')
        expect(first.replacements).toBe(1)
        expect(second.replacements).toBe(0)
    })

    test('does not share results across different replacements', () => {
        expect(cachedRegexReplace('aaa', /a/g, 'x')).toBe('xxx')
        expect(cachedRegexReplace('aaa', /a/g, 'y')).toBe('yyy')
    })

    test('accounts for the lastIndex of sticky regexes', () => {
        const fromStart = /a/y
        const fromSecondCharacter = /a/y
        fromSecondCharacter.lastIndex = 1

        expect(cachedRegexReplace('aa', fromStart, 'x')).toBe('xa')
        expect(cachedRegexReplace('aa', fromSecondCharacter, 'x')).toBe('ax')
    })
})
