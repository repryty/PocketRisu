import { describe, expect, it } from 'vitest'
import {
    proxy2ClientTransport,
    proxy2IsGatewayHtml,
    proxy2SanitizedGateway,
    type Proxy2Fetch,
} from './proxy2Client'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Build a fake fetch whose responses are queued. Each call advances to the
// next scripted behavior. Lets tests script "502 then 200", "always throw",
// "always 502 HTML", etc.
interface ScriptedCall {
    status?: number
    body?: string
    contentType?: string
    requestId?: string
    headers?: Record<string, string>
    // If set, the fetch rejects with this error instead of returning.
    throwErr?: unknown
    // If set, the fetch returns a streaming Response backed by these chunks
    // (used to verify success paths do not buffer).
    streamChunks?: string[]
}

function makeFetchFn(script: ScriptedCall[]): { fn: Proxy2Fetch; calls: { count: number } } {
    let i = 0
    const calls = { count: 0 }
    const fn: Proxy2Fetch = async () => {
        const step = script[Math.min(i, script.length - 1)]
        i++
        calls.count++
        if (step.throwErr) throw step.throwErr
        const headers = new Headers(step.headers ?? {})
        if (step.contentType) headers.set('content-type', step.contentType)
        if (step.requestId) headers.set('x-risu-proxy-request-id', step.requestId)
        if (step.streamChunks) {
            const stream = new ReadableStream({
                start(controller) {
                    for (const c of step.streamChunks!) controller.enqueue(new TextEncoder().encode(c))
                    controller.close()
                },
            })
            return new Response(stream, { status: step.status ?? 200, headers })
        }
        return new Response(step.body ?? '', { status: step.status ?? 200, headers })
    }
    return { fn, calls }
}

describe('proxy2IsGatewayHtml', () => {
    it('flags 502/503/504 with text/html', () => {
        expect(proxy2IsGatewayHtml(502, 'text/html; charset=utf-8', '')).toBe(true)
        expect(proxy2IsGatewayHtml(503, 'TEXT/HTML', '')).toBe(true)
        expect(proxy2IsGatewayHtml(504, 'text/html', '')).toBe(true)
    })
    it('flags Cloudflare markers without html content-type', () => {
        expect(proxy2IsGatewayHtml(502, 'application/json', 'cloudflare error page')).toBe(true)
        expect(proxy2IsGatewayHtml(502, '', '<!DOCTYPE html>...')).toBe(true)
    })
    it('does not flag JSON proxy errors or 2xx', () => {
        expect(proxy2IsGatewayHtml(502, 'application/json', '{"error":"x"}')).toBe(false)
        expect(proxy2IsGatewayHtml(200, 'text/html', '<html>')).toBe(false)
        expect(proxy2IsGatewayHtml(429, 'text/html', '')).toBe(false)
    })
})

describe('proxy2SanitizedGateway', () => {
    it('produces a short plain-text error with metadata, not HTML', async () => {
        const r = proxy2SanitizedGateway(502, 'rid-123', 2)
        expect(r.status).toBe(502)
        expect(r.headers.get('content-type')).toContain('text/plain')
        expect(r.headers.get('x-risu-proxy-request-id')).toBe('rid-123')
        expect(r.headers.get('x-risu-proxy-retries')).toBe('2')
        expect(r.headers.get('x-risu-proxy-gateway')).toBe('1')
        const text = await r.text()
        expect(text).toContain('PocketRisu proxy gateway error (502)')
        expect(text).not.toContain('<html')
    })
})

describe('proxy2ClientTransport', () => {
    const buildHeaders = async () => ({ 'risu-url': 'enc' })

    // Success path — success responses must pass through unbuffered.
    it('returns a success response without buffering the stream', async () => {
        const { fn } = makeFetchFn([{ status: 200, streamChunks: ['a', 'b', 'c'], contentType: 'text/plain' }])
        const r = await proxy2ClientTransport({ fetchFn: fn, method: 'GET', buildHeaders })
        expect(r.status).toBe(200)
        const chunks: string[] = []
        for await (const c of r.body as any) chunks.push(new TextDecoder().decode(c))
        expect(chunks.join('')).toBe('abc')
    })

    // 9. A Cloudflare-style 502 HTML response is retried for GET/HEAD.
    it('retries a Cloudflare 502 HTML response for GET then succeeds', async () => {
        const { fn, calls } = makeFetchFn([
            { status: 502, contentType: 'text/html', body: '<!DOCTYPE html>cloudflare 502', requestId: 'r1' },
            { status: 200, body: 'ok', contentType: 'text/plain', requestId: 'r2' },
        ])
        const r = await proxy2ClientTransport({
            fetchFn: fn, method: 'GET', buildHeaders,
            backoffMs: [10, 10],
        })
        expect(r.status).toBe(200)
        expect(await r.text()).toBe('ok')
        expect(calls.count).toBe(2)
    })

    it('retries on a transient network exception for GET', async () => {
        const { fn, calls } = makeFetchFn([
            { throwErr: new TypeError('fetch failed') },
            { status: 200, body: 'ok', contentType: 'text/plain' },
        ])
        const r = await proxy2ClientTransport({
            fetchFn: fn, method: 'GET', buildHeaders, backoffMs: [10, 10],
        })
        expect(r.status).toBe(200)
        expect(calls.count).toBe(2)
    })

    // 10. After retry exhaustion, Cloudflare HTML is replaced with a short sanitized error.
    it('sanitizes Cloudflare HTML after exhausting retries', async () => {
        const { fn, calls } = makeFetchFn([
            { status: 502, contentType: 'text/html', body: '<!DOCTYPE html><title>cloudflare 502</title>', requestId: 'r1' },
            { status: 502, contentType: 'text/html', body: '<!DOCTYPE html><title>cloudflare 502</title>', requestId: 'r2' },
            { status: 502, contentType: 'text/html', body: '<!DOCTYPE html><title>cloudflare 502</title>', requestId: 'r3' },
        ])
        const r = await proxy2ClientTransport({
            fetchFn: fn, method: 'GET', buildHeaders, backoffMs: [10, 10],
        })
        expect(r.status).toBe(502)
        expect(r.headers.get('content-type')).toContain('text/plain')
        expect(r.headers.get('x-risu-proxy-retries')).toBe('2')
        const text = await r.text()
        expect(text).toContain('PocketRisu proxy gateway error (502)')
        expect(text).not.toContain('cloudflare')
        expect(text).not.toContain('<!DOCTYPE')
        expect(calls.count).toBe(3)
    })

    // Non-idempotent methods are not retried on gateway status.
    it('does not retry POST on a 502 HTML gateway response', async () => {
        const { fn, calls } = makeFetchFn([
            { status: 502, contentType: 'text/html', body: '<!DOCTYPE html>cf 502', requestId: 'r1' },
        ])
        const r = await proxy2ClientTransport({
            fetchFn: fn, method: 'POST', buildHeaders, backoffMs: [10, 10],
        })
        expect(r.status).toBe(502)
        expect(r.headers.get('x-risu-proxy-retries')).toBe('0')
        // POST still gets the sanitized message (no HTML leaked).
        const text = await r.text()
        expect(text).toContain('PocketRisu proxy gateway error (502)')
        expect(text).not.toContain('<!DOCTYPE')
        expect(calls.count).toBe(1)
    })

    // A non-HTML gateway status (PocketRisu controlled JSON error) is passed through.
    it('passes through a JSON gateway error without retrying', async () => {
        const { fn, calls } = makeFetchFn([
            { status: 502, contentType: 'application/json', body: '{"code":"PROXY_UPSTREAM_NETWORK_ERROR"}', requestId: 'r1' },
        ])
        const r = await proxy2ClientTransport({
            fetchFn: fn, method: 'GET', buildHeaders, backoffMs: [10, 10],
        })
        expect(r.status).toBe(502)
        expect(await r.text()).toBe('{"code":"PROXY_UPSTREAM_NETWORK_ERROR"}')
        expect(calls.count).toBe(1) // JSON controlled error → no client retry
    })

    // 6. AbortSignal stops retries immediately.
    it('aborts immediately when the signal fires during backoff', async () => {
        const ac = new AbortController()
        const { fn, calls } = makeFetchFn([{ throwErr: new TypeError('fetch failed') }])
        // Abort shortly after the first failed call, during the backoff window.
        setTimeout(() => ac.abort(), 5)
        await expect(proxy2ClientTransport({
            fetchFn: fn, method: 'GET', signal: ac.signal, buildHeaders, backoffMs: [200, 200],
        })).rejects.toThrow()
        // Should not have burned all retries; at most 1-2 calls before aborting.
        expect(calls.count).toBeLessThan(3)
    })

    it('aborts immediately when the signal is already aborted', async () => {
        const ac = new AbortController()
        ac.abort()
        const { fn, calls } = makeFetchFn([{ status: 200, body: 'ok' }])
        await expect(proxy2ClientTransport({
            fetchFn: fn, method: 'GET', signal: ac.signal, buildHeaders,
        })).rejects.toThrow()
        expect(calls.count).toBe(0)
    })

    it('propagates an AbortError from fetch without retrying', async () => {
        const ac = new AbortController()
        const { fn, calls } = makeFetchFn([{ throwErr: new DOMException('Aborted', 'AbortError') }])
        // Trigger abort so the fetch's AbortError is recognized as an abort.
        setTimeout(() => ac.abort(), 5)
        await expect(proxy2ClientTransport({
            fetchFn: fn, method: 'GET', signal: ac.signal, buildHeaders, backoffMs: [10, 10],
        })).rejects.toThrow()
        expect(calls.count).toBe(1)
    })

    it('rebuilds headers on each attempt (auth may refresh)', async () => {
        let n = 0
        const buildHeaders = async () => { n++; return { 'x-call': String(n) } }
        const seen: Record<string, string>[] = []
        const fn: Proxy2Fetch = async (_u, init) => {
            seen.push(init?.headers as Record<string, string>)
            const idx = seen.length
            if (idx < 3) throw new TypeError('fetch failed')
            return new Response('ok', { status: 200, headers: { 'content-type': 'text/plain' } })
        }
        const r = await proxy2ClientTransport({
            fetchFn: fn, method: 'GET', buildHeaders, backoffMs: [1, 1],
        })
        expect(r.status).toBe(200)
        expect(seen.length).toBe(3)
        expect(seen[0]['x-call']).toBe('1')
        expect(seen[2]['x-call']).toBe('3')
    })

    // Regression: production injects the browser-native fetch into the transport
    // as a detached callback (fetchFn: fetch). On browsers whose Window.fetch is
    // a WebIDL interface method, calling it without a Window receiver throws
    // "'fetch' called on an object that does not implement interface Window"
    // before /proxy2 is ever requested. The ordinary fake functions used by the
    // tests above are plain closures that never inspect `this`, so they cannot
    // detect this class of receiver-binding regression. This block models a
    // WebIDL-style method that throws unless invoked on its owning interface,
    // and verifies the production adapter form — an arrow wrapper that re-roots
    // the call onto the interface object — preserves the receiver.
    describe('receiver binding (WebIDL-style native methods)', () => {
        // A window-like interface whose `fetch` is a WebIDL-style method: it
        // rejects any `this` that is not the interface instance, mirroring how
        // Window.fetch behaves in browsers that enforce interface receivers.
        function makeWindowLike() {
            const win = {
                fetch(_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> {
                    if (this !== win) {
                        throw new TypeError(
                            "'fetch' called on an object that does not implement interface Window"
                        )
                    }
                    return Promise.resolve(new Response('ok', {
                        status: 200,
                        headers: { 'content-type': 'text/plain' },
                    }))
                },
            }
            return win
        }
        const buildHeaders = async () => ({ 'risu-url': 'enc' })

        it('reproduces the regression when the native method is passed detached', async () => {
            const win = makeWindowLike()
            // `fetchFn: fetch` form — `this` is lost when the transport invokes
            // it as a plain function call (opts.fetchFn(...)).
            await expect(proxy2ClientTransport({
                fetchFn: win.fetch as Proxy2Fetch,
                method: 'POST', buildHeaders,
            })).rejects.toThrow(/does not implement interface Window/)
        })

        it('preserves the receiver when the adapter re-roots fetch onto window', async () => {
            const win = makeWindowLike()
            // Production adapter form: (input, init) => window.fetch(input, init).
            // The member access re-binds the receiver to `win` on every call.
            const r = await proxy2ClientTransport({
                fetchFn: (input, init) => win.fetch(input, init),
                method: 'POST', buildHeaders,
            })
            expect(r.status).toBe(200)
            expect(await r.text()).toBe('ok')
        })

        it('preserves the receiver across retries (gateway-HTML path)', async () => {
            // The receiver must survive the retry loop too: each attempt
            // re-invokes fetchFn, so a detached method would throw on retry.
            const win = makeWindowLike()
            const realFetch = win.fetch.bind(win)
            let calls = 0
            const winWithRetry: typeof win = {
                fetch(input, init) {
                    if (this !== winWithRetry) {
                        throw new TypeError(
                            "'fetch' called on an object that does not implement interface Window"
                        )
                    }
                    calls++
                    // First call: a Cloudflare-style 502 HTML page. Second: ok.
                    if (calls === 1) {
                        return Promise.resolve(new Response('<!DOCTYPE html>cloudflare', {
                            status: 502,
                            headers: { 'content-type': 'text/html', 'x-risu-proxy-request-id': 'r1' },
                        }))
                    }
                    return realFetch(input, init)
                },
            }
            const r = await proxy2ClientTransport({
                fetchFn: (input, init) => winWithRetry.fetch(input, init),
                method: 'GET', buildHeaders, backoffMs: [1, 1],
            })
            expect(r.status).toBe(200)
            expect(await r.text()).toBe('ok')
            expect(calls).toBe(2)
        })
    })
})