import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import http from 'node:http'
import express from 'express'
import { registerProxy2Routes } from './proxy2.cjs'

const AUTH_TOKEN = 'test-token'

// Stub with the same contract as server.cjs checkAuth: sends its own error
// response and returns false when the risu-auth header is missing/wrong.
async function stubAuth(req: any, res: any) {
    if (req.headers['risu-auth'] === AUTH_TOKEN) return true
    res.status(400).send({ error: 'No auth header' })
    return false
}

function listen(server: http.Server): Promise<number> {
    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
            resolve((server.address() as any).port)
        })
    })
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

interface UpstreamBehavior {
    mode: 'ok' | 'fail-net' | '502' | 'hang' | 'stream'
    failCount: number       // for fail-net/502: fail the first N requests, then ok
    status: number
    body: string
    chunks: string[]        // for stream mode
    chunkDelayMs: number
    delayMs: number         // delay before responding in the ok/default branch
    hits: number
    closed: boolean
    receivedBody: Buffer | null
    aborted: boolean        // set if the upstream socket was destroyed mid-response
}

describe('proxy2 server transport', () => {
    let appServer: http.Server
    let base: string
    let upstreamServer: http.Server
    let upstreamUrl: string
    let upstream: UpstreamBehavior
    // Captured server-side req of the most recent /proxy2 request, so a test can
    // deterministically drive IncomingMessage lifecycle events (e.g. emit
    // 'close') at a chosen moment — see the delayed-POST regression test.
    let lastReq: any
    const logLines: string[] = []
    const logger = {
        info: (...a: any[]) => { logLines.push(['INFO', ...a].join(' ')) },
        warn: (...a: any[]) => { logLines.push(['WARN', ...a].join(' ')) },
        error: (...a: any[]) => { logLines.push(['ERROR', ...a].join(' ')) },
    }

    function resetUpstream(over: Partial<UpstreamBehavior> = {}) {
        upstream = Object.assign({
            mode: 'ok',
            failCount: 0,
            status: 200,
            body: 'hello-upstream',
            chunks: [],
            chunkDelayMs: 80,
            delayMs: 0,
            hits: 0,
            closed: false,
            aborted: false,
            receivedBody: null,
        } as UpstreamBehavior, over)
    }

    beforeAll(async () => {
        const app = express()
        app.use(express.json({ limit: '10mb' }))
        app.use(express.text({ limit: '10mb', type: 'text/*' }))
        app.use(express.raw({ type: '*/*', limit: '10mb' }))
        // Capture the server-side req for tests that drive lifecycle events.
        app.use((req: any, _res: any, next: any) => { lastReq = req; next() })
        registerProxy2Routes(app, { checkAuth: stubAuth, logger: logger as any, authCodePath: '' })
        appServer = http.createServer(app)
        base = `http://127.0.0.1:${await listen(appServer)}`

        upstreamServer = http.createServer((req, res) => {
            upstream.hits++
            upstream.closed = false
            const parts: Buffer[] = []
            req.on('data', (c) => parts.push(c))
            req.on('end', async () => {
                upstream.receivedBody = Buffer.concat(parts)
                res.on('close', () => { upstream.closed = true })
                // The proxy aborting its upstream fetch destroys this socket. Track
                // it so the delayed-POST test can prove the upstream was NOT torn
                // down on a normal request whose body has already been received.
                req.socket?.once?.('close', () => {
                    if (!res.writableEnded) upstream.aborted = true
                })

                if (upstream.mode === 'hang') {
                    // Never respond. Holds the socket open until aborted/closed.
                    return
                }
                if (upstream.mode === 'fail-net' && upstream.hits <= upstream.failCount) {
                    // Abruptly destroy the socket → proxy's fetch throws a transport error.
                    try { req.socket?.destroy() } catch { /* ignore */ }
                    try { res.destroy() } catch { /* ignore */ }
                    return
                }
                if (upstream.mode === '502' && upstream.hits <= upstream.failCount) {
                    res.writeHead(502, { 'content-type': 'text/html' })
                    res.end('<!DOCTYPE html><html><title>Bad Gateway</title></html>')
                    return
                }
                if (upstream.mode === 'stream') {
                    res.writeHead(upstream.status, { 'content-type': 'text/plain' })
                    for (const chunk of upstream.chunks) {
                        res.write(chunk)
                        if (upstream.chunkDelayMs > 0) await sleep(upstream.chunkDelayMs)
                    }
                    res.end()
                    return
                }
                // Default ok branch: optionally hold the connection open *after* the
                // request body has been fully received but before responding, to
                // model a slow upstream model response.
                if (upstream.delayMs > 0) await sleep(upstream.delayMs)
                res.writeHead(upstream.status, { 'content-type': 'text/plain' })
                res.end(upstream.body)
            })
        })
        upstreamUrl = `http://127.0.0.1:${await listen(upstreamServer)}`
    })

    beforeEach(() => {
        logLines.length = 0
        resetUpstream()
    })

    afterAll(async () => {
        await Promise.all([
            new Promise((r) => appServer.close(() => r(null))),
            new Promise((r) => upstreamServer.close(() => r(null))),
        ])
    })

    async function proxyGet(extraHeaders: Record<string, string> = {}, timeoutMs?: number) {
        const headers: Record<string, string> = {
            'risu-auth': AUTH_TOKEN,
            'risu-url': upstreamUrl,
            'risu-header': encodeURIComponent(JSON.stringify({ accept: 'text/plain' })),
            ...extraHeaders,
        }
        if (timeoutMs) headers['risu-timeout-ms'] = String(timeoutMs)
        return await fetch(`${base}/proxy2`, { method: 'GET', headers })
    }

    async function proxyPost(body: any, extraHeaders: Record<string, string> = {}) {
        const headers: Record<string, string> = {
            'risu-auth': AUTH_TOKEN,
            'risu-url': upstreamUrl,
            'risu-header': encodeURIComponent(JSON.stringify({ 'content-type': 'application/json' })),
            'content-type': 'application/json',
            ...extraHeaders,
        }
        return await fetch(`${base}/proxy2`, {
            method: 'POST', headers, body: JSON.stringify(body),
        })
    }

    async function readText(res: Response): Promise<string> {
        return await res.text()
    }

    // 1. GET through /proxy2 succeeds normally.
    it('GET succeeds normally and preserves upstream status/body', async () => {
        resetUpstream({ mode: 'ok', status: 200, body: 'ok-body' })
        const res = await proxyGet()
        expect(res.status).toBe(200)
        expect(await readText(res)).toBe('ok-body')
        expect(upstream.hits).toBe(1)
        expect(res.headers.get('x-risu-proxy-request-id')).toBeTruthy()
    })

    // 2. GET upstream fails once with a transient network error, then succeeds.
    it('GET retries a transient network failure then succeeds', async () => {
        resetUpstream({ mode: 'fail-net', failCount: 1, status: 200, body: 'recovered' })
        const res = await proxyGet()
        expect(res.status).toBe(200)
        expect(await readText(res)).toBe('recovered')
        expect(upstream.hits).toBe(2) // 1 failed + 1 success
    })

    // 3. GET upstream returns 502 once, then succeeds.
    it('GET retries an upstream 502 then succeeds', async () => {
        resetUpstream({ mode: '502', failCount: 1, status: 200, body: 'after-502' })
        const res = await proxyGet()
        expect(res.status).toBe(200)
        expect(await readText(res)).toBe('after-502')
        expect(upstream.hits).toBe(2)
    })

    // 4. GET exhausts retries and returns a controlled proxy error.
    it('GET exhausts retries and returns a controlled JSON 502', async () => {
        resetUpstream({ mode: 'fail-net', failCount: 99 })
        const res = await proxyGet()
        expect(res.status).toBe(502)
        expect(res.headers.get('content-type')).toContain('application/json')
        const data = await res.json()
        expect(data.code).toBe('PROXY_UPSTREAM_NETWORK_ERROR')
        expect(data.requestId).toBeTruthy()
        expect(data.error).toBe('Proxy upstream request failed')
        expect(upstream.hits).toBe(3) // initial + 2 retries
        // No HTML error document — the controlled error is JSON.
        expect(res.headers.get('content-type')).toContain('application/json')
        expect(res.headers.get('content-type')).not.toContain('text/html')
    })

    // 5. POST returning/failing with 502 is NOT automatically retried.
    it('POST with upstream 502 is not retried', async () => {
        resetUpstream({ mode: '502', failCount: 99 })
        const res = await proxyPost({ prompt: 'hi' })
        expect(res.status).toBe(502)
        expect(upstream.hits).toBe(1) // no retry for non-idempotent
        expect(upstream.receivedBody?.toString()).toBe(JSON.stringify({ prompt: 'hi' }))
    })

    it('POST with a transient network failure returns a controlled 502 and is not retried', async () => {
        resetUpstream({ mode: 'fail-net', failCount: 99 })
        const res = await proxyPost({ prompt: 'hi' })
        expect(res.status).toBe(502)
        const data = await res.json()
        expect(data.code).toBe('PROXY_UPSTREAM_NETWORK_ERROR')
        expect(upstream.hits).toBe(1)
    })

    // Regression: a normal POST whose incoming request body has completed but
    // whose upstream response is still in flight MUST NOT be treated as a client
    // disconnect. The previous handler wired the upstream abort to req('close'),
    // and Node's http.IncomingMessage emits 'close' when the request body has
    // been fully read — which for a POST happens while the upstream model
    // response is still pending, so the upstream fetch was aborted and the AI
    // request failed.
    //
    // The false abort is tick-timing-dependent in an integration test (Express
    // buffers the body, the handler is microtask-deferred, so the automatic
    // req 'close' can race past the listener), so this test drives the event
    // deterministically: it emits 'close' on the captured server-side req AFTER
    // the upstream fetch has started, exactly modeling "body fully received,
    // socket still open, upstream still pending." The buggy req.on('close')
    // handler aborts on this; the fixed res.on('close') handler must not.
    it('a normal delayed POST is not interpreted as a client disconnect', async () => {
        resetUpstream({ mode: 'ok', delayMs: 400, status: 200, body: 'delayed-ok' })
        const fetchPromise = proxyPost({ prompt: 'slow-request' })
        // Let the handler reach the upstream fetch and attach its listeners.
        await sleep(120)
        // The incoming request body has now been fully received — fire the
        // IncomingMessage 'close' event while the upstream is still pending.
        lastReq?.emit?.('close')
        const res = await fetchPromise
        // The response must succeed — the upstream fetch was not aborted.
        expect(res.status).toBe(200)
        expect(await readText(res)).toBe('delayed-ok')
        // Upstream received the full body.
        expect(upstream.receivedBody?.toString()).toBe(JSON.stringify({ prompt: 'slow-request' }))
        // The upstream connection was NOT torn down mid-response (no abort).
        expect(upstream.aborted).toBe(false)
        // Exactly one upstream request — no retry on a normal POST.
        expect(upstream.hits).toBe(1)
        // The false-disconnect path must not have been taken.
        const dump = logLines.join('\n')
        expect(dump).not.toContain('clientClosed=1')
        expect(dump).not.toContain('client-disconnected')
    })

    // (server variant) timeout stops retries immediately → 504.
    it('timeout aborts the upstream fetch and returns 504 without retrying', async () => {
        resetUpstream({ mode: 'hang' })
        const res = await proxyGet({}, 200)
        expect(res.status).toBe(504)
        const data = await res.json()
        expect(data.code).toBe('PROXY_TIMEOUT')
        expect(upstream.hits).toBe(1)
        // Upstream connection should have been torn down by the abort.
        await sleep(50)
        expect(upstream.closed).toBe(true)
    })

    // 7. Client disconnect aborts the upstream request.
    it('client disconnect aborts the upstream request', async () => {
        resetUpstream({ mode: 'hang' })
        const ac = new AbortController()
        const fetchPromise = fetch(`${base}/proxy2`, {
            method: 'GET',
            headers: {
                'risu-auth': AUTH_TOKEN,
                'risu-url': upstreamUrl,
                'risu-header': encodeURIComponent(JSON.stringify({})),
            },
            signal: ac.signal,
        })
        // Let the request reach the handler and the upstream fetch start.
        await sleep(150)
        ac.abort()
        await expect(fetchPromise).rejects.toThrow()
        // The upstream connection must be closed (no orphaned request).
        await sleep(150)
        expect(upstream.closed).toBe(true)
        // And only one upstream attempt was made (no retry after disconnect).
        expect(upstream.hits).toBe(1)
    })

    // 8. Successful streaming responses are not buffered or replayed.
    it('streams a successful response progressively without replay', async () => {
        resetUpstream({
            mode: 'stream',
            status: 200,
            chunks: ['chunk-1\n', 'chunk-2\n', 'chunk-3\n'],
            chunkDelayMs: 80,
        })
        const res = await proxyGet()
        expect(res.status).toBe(200)
        // Content-Length must be stripped so the body streams chunked.
        expect(res.headers.get('content-length')).toBeNull()
        const received: { t: number; data: string }[] = []
        const start = Date.now()
        for await (const chunk of res.body as any) {
            received.push({ t: Date.now() - start, data: Buffer.from(chunk).toString() })
        }
        expect(received.length).toBeGreaterThanOrEqual(2)
        // Progressive delivery: last chunk arrives noticeably later than first.
        expect(received[received.length - 1].t - received[0].t).toBeGreaterThanOrEqual(100)
        expect(received.map((r) => r.data).join('')).toBe('chunk-1\nchunk-2\nchunk-3\n')
        expect(upstream.hits).toBe(1) // no replay
    })

    // 11. /proxy2 diagnostic logs do not expose authorization headers or API keys.
    it('logs do not expose authorization headers, API keys, cookies, or body', async () => {
        resetUpstream({ mode: 'ok', body: 'fine' })
        const secretHeaders = {
            authorization: 'Bearer SECRET-TOKEN-XYZ',
            'x-api-key': 'TOPSECRET-API-KEY',
            cookie: 'session=COOKIE-SESSION-VAL',
        }
        const res = await proxyGet({
            'risu-header': encodeURIComponent(JSON.stringify(secretHeaders)),
        })
        expect(res.status).toBe(200)
        const dump = logLines.join('\n')
        expect(dump).not.toContain('SECRET-TOKEN-XYZ')
        expect(dump).not.toContain('TOPSECRET-API-KEY')
        expect(dump).not.toContain('COOKIE-SESSION-VAL')
        // Request id is logged and echoed back.
        const rid = res.headers.get('x-risu-proxy-request-id')
        expect(rid).toBeTruthy()
        expect(dump).toContain(`id=${rid}`)
        // The query/path must not carry secrets; host+path only.
        expect(dump).toContain('target=http://127.0.0.1:')
    })

    it('preserves a non-2xx upstream status that arrived successfully', async () => {
        resetUpstream({ mode: 'ok', status: 418, body: "i'm a teapot" })
        const res = await proxyGet()
        expect(res.status).toBe(418)
        expect(await readText(res)).toBe("i'm a teapot")
        expect(upstream.hits).toBe(1)
    })
})