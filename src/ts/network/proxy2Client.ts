// Pure /proxy2 client transport: retry + gateway-HTML sanitization for the
// browser → Cloudflare/Tunnel → PocketRisu hop.
//
// This module is dependency-free on purpose so it can be unit-tested in
// isolation. fetchViaProxy2() in globalApi.svelte.ts injects the real fetch,
// the auth-bearing header builder, and the request body; everything else
// (retry policy, gateway detection, sanitization, streaming preservation)
// lives here.
//
// The server-side retry (server/node/proxy2.cjs) handles PocketRisu → upstream
// failures. THIS retry handles the hop in front of the Node process: a
// Cloudflare 502/503/504 can occur before the request ever reaches PocketRisu
// and surface as a whole Cloudflare HTML error page. We retry those for
// idempotent methods and, once exhausted, replace the HTML with a short
// sanitized message so it never leaks into application error text. Successful
// responses are returned unbuffered to preserve streaming semantics.

export const PROXY2_CLIENT_MAX_ATTEMPTS = 3        // initial + 2 retries
export const PROXY2_CLIENT_BACKOFF_MS = [150, 400]
export const PROXY2_GATEWAY_STATUS = new Set([502, 503, 504])
export const PROXY2_RETRYABLE_METHODS = new Set(['GET', 'HEAD'])

export type Proxy2Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export interface Proxy2TransportOptions {
    /** Injected fetch (real fetch in production, a fake in tests). */
    fetchFn: Proxy2Fetch
    /** Builds the /proxy2 request headers fresh each attempt (auth may refresh). */
    buildHeaders: () => Promise<Record<string, string>>
    /** Request body, or undefined for GET/HEAD. */
    body?: BodyInit | undefined
    /** HTTP method. Only GET/HEAD are retried. */
    method: string
    /** AbortSignal honored across attempts and backoff. */
    signal?: AbortSignal
    /** Same-origin proxy endpoint. Defaults to '/proxy2'. */
    proxyUrl?: string
    /** Override attempts/backoff for tests. */
    maxAttempts?: number
    backoffMs?: number[]
}

function abortableSleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
    return new Promise((resolve) => {
        if (!signal || signal.aborted) return resolve()
        const t = setTimeout(resolve, ms)
        signal.addEventListener('abort', () => { clearTimeout(t); resolve() }, { once: true })
    })
}

// Detect a Cloudflare-style gateway error page so we can retry/sanitize it.
// Triggered on 502/503/504 with an HTML content-type (or obvious CF markers).
export function proxy2IsGatewayHtml(status: number, contentType: string, body: string): boolean {
    if (!PROXY2_GATEWAY_STATUS.has(status)) return false
    const ct = (contentType || '').toLowerCase()
    if (ct.includes('text/html')) return true
    const head = (body || '').slice(0, 4096).toLowerCase()
    return head.includes('cloudflare') || head.includes('cf-error') || head.includes('cf-ray') || head.includes('<!doctype html')
}

// Short, sanitized gateway error. Preserves status + request id + retry count
// without dumping the upstream/Cloudflare HTML page into UI errors.
export function proxy2SanitizedGateway(status: number, requestId: string, retries: number): Response {
    return new Response(`PocketRisu proxy gateway error (${status})\n`, {
        status,
        headers: {
            'content-type': 'text/plain; charset=utf-8',
            'x-risu-proxy-request-id': requestId || '',
            'x-risu-proxy-gateway': '1',
            'x-risu-proxy-retries': String(retries),
        }
    })
}

function isAbortError(e: unknown, signal?: AbortSignal): boolean {
    if (signal?.aborted) return true
    return e instanceof DOMException && e.name === 'AbortError'
}

export async function proxy2ClientTransport(opts: Proxy2TransportOptions): Promise<Response> {
    const method = (opts.method ?? 'POST').toUpperCase()
    const retryable = PROXY2_RETRYABLE_METHODS.has(method)
    const maxAttempts = opts.maxAttempts ?? (retryable ? PROXY2_CLIENT_MAX_ATTEMPTS : 1)
    const backoffMs = opts.backoffMs ?? PROXY2_CLIENT_BACKOFF_MS
    const proxyUrl = opts.proxyUrl ?? '/proxy2'
    const signal = opts.signal
    let lastRequestId = ''

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')

        const headers = await opts.buildHeaders()
        let r: Response
        try {
            r = await opts.fetchFn(proxyUrl, {
                body: opts.body as BodyInit | undefined,
                headers,
                method,
                signal,
            })
        } catch (e) {
            // AbortSignal must propagate immediately — never retry an abort.
            if (isAbortError(e, signal)) throw e
            if (retryable && attempt < maxAttempts) {
                await abortableSleep(backoffMs[attempt - 1] ?? 400, signal)
                continue
            }
            throw e
        }

        const requestId = r.headers.get('x-risu-proxy-request-id') || ''
        if (requestId) lastRequestId = requestId

        if (PROXY2_GATEWAY_STATUS.has(r.status)) {
            const contentType = r.headers.get('content-type') || ''
            const isHtml = proxy2IsGatewayHtml(r.status, contentType, '')
            // Only HTML gateway responses are buffered (error pages, small). JSON
            // gateway responses (PocketRisu's own controlled errors) are passed
            // through unbuffered — they are already machine-readable.
            if (isHtml) {
                let body = ''
                try { body = await r.text() } catch { /* ignore read failure */ }
                if (retryable && attempt < maxAttempts && !signal?.aborted) {
                    await abortableSleep(backoffMs[attempt - 1] ?? 400, signal)
                    continue
                }
                // Retries exhausted (or non-idempotent): never surface the CF HTML.
                return proxy2SanitizedGateway(r.status, requestId, attempt - 1)
            }
            // Non-HTML gateway status: PocketRisu controlled proxy error (JSON).
            // The server already retried the upstream, so do not retry here; pass
            // the response through with its real status and body preserved.
            return new Response(r.body, { headers: r.headers, status: r.status })
        }

        // Success — do NOT buffer; return the live stream so callers can stream.
        return new Response(r.body, { headers: r.headers, status: r.status })
    }

    // Defensive fallback (loop only exits here if a retryable gateway path
    // continued on the final attempt without returning — should not happen).
    return proxy2SanitizedGateway(502, lastRequestId, maxAttempts - 1)
}