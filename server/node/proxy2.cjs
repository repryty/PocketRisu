// Hardened /proxy2 (and legacy /proxy) reverse-proxy handler.
//
// This module owns the server side of the proxy transport:
//
//   browser → Cloudflare/Tunnel → PocketRisu /proxy2 → upstream server
//                                      ^^^^^^^^
//                                   this code
//
// Responsibilities (see the hardening task):
//   * Make every /proxy2 request observable via concise diagnostic logs that
//     never carry auth headers, API keys, cookies, or request bodies.
//   * Return small, machine-readable JSON errors on upstream transport failure
//     instead of letting raw fetch exceptions fall through to Express (which
//     would render an HTML error document).
//   * Retry idempotent (GET/HEAD) upstream attempts a bounded number of times on
//     transient network failures and upstream 502/503/504.
//   * Tie the upstream fetch to BOTH the request timeout AND the client
//     connection lifetime, so a browser disconnect aborts the upstream fetch.
//   * Preserve streaming for successful responses — retry only happens before a
//     usable response stream has been committed.
//
// The client-side retry (Cloudflare/Tunnel → PocketRisu transport) lives in
// fetchViaProxy2 in src/ts/globalApi.svelte.ts; this module handles the
// PocketRisu → upstream leg.

const nodeCrypto = require('crypto')
const { existsSync } = require('fs')
const fs = require('fs/promises')
const { pipeline } = require('stream/promises')

// Upstream HTTP statuses that are reasonably transient for idempotent retries.
const PROXY2_TRANSIENT_STATUS = new Set([502, 503, 504])
// Methods safe to retry automatically. POST/PUT/PATCH/DELETE may have side
// effects, duplicate API calls, or duplicate billing — never retry those.
const PROXY2_IDEMPOTENT_METHODS = new Set(['GET', 'HEAD'])
// Initial attempt + at most 2 additional retries.
const PROXY2_MAX_ATTEMPTS = 3
const PROXY2_BACKOFF_MS = [150, 400]

function getRequestTimeoutMs(headers) {
    const raw = headers['risu-timeout-ms']
    const v = Array.isArray(raw) ? raw[0] : raw
    if (!v) return null
    const n = parseInt(v, 10)
    return Number.isFinite(n) && n > 0 ? n : null
}

// Log-safe target: protocol//host/path — strips query (may carry API keys)
// and userinfo. Falls back to a truncated raw string for unparseable inputs.
function safeTargetForLog(rawUrl) {
    if (!rawUrl) return ''
    try {
        const u = new URL(rawUrl)
        return `${u.protocol}//${u.host}${u.pathname}`
    } catch {
        return String(rawUrl).slice(0, 200)
    }
}

// Redact the raw target URL (and any other URL carrying a query string) from
// an upstream error message so logs never leak API keys passed in the query.
function redactMessage(msg, rawUrl, safeUrl) {
    if (!msg) return ''
    let s = String(msg)
    if (rawUrl) {
        s = s.split(rawUrl).join(safeUrl)
    }
    return s.replace(/https?:\/\/[^\s'"<>]+/g, (u) => {
        try {
            const p = new URL(u)
            return `${p.protocol}//${p.host}${p.pathname}`
        } catch {
            return u
        }
    })
}

// A thrown fetch exception is an upstream transport failure. AbortError is
// NOT transient — it's our own timeout/client-disconnect abort and must not
// trigger a retry (it has already consumed the timeout budget or the client).
function isTransientError(err) {
    if (!err) return false
    if (err.name === 'AbortError') return false
    return true
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

// Backoff that resolves early on abort so the retry loop can re-check the
// signal and bail out immediately (test: AbortSignal stops retries instantly).
function abortableSleep(ms, signal) {
    return new Promise((resolve) => {
        if (!signal || signal.aborted) return resolve()
        const t = setTimeout(resolve, ms)
        const onAbort = () => { clearTimeout(t); resolve() }
        signal.addEventListener('abort', onAbort, { once: true })
    })
}

// Send a small, machine-readable JSON proxy error. Never returns HTML, never
// surfaces the upstream/Cloudflare error body. Idempotent if headers sent.
function sendProxyError(res, status, code, message, requestId, extra) {
    if (res.headersSent || res.writableEnded) {
        try { res.end() } catch { /* client gone */ }
        return
    }
    try {
        res.status(status)
        res.setHeader('content-type', 'application/json; charset=utf-8')
        res.setHeader('x-risu-proxy-request-id', requestId)
        res.send(JSON.stringify(Object.assign({ error: message, code, requestId }, extra || {})))
    } catch { /* socket already closed */ }
}

// Headers we strip from the forwarded upstream response. Node's fetch already
// decompressed the body, so upstream Content-Encoding/Length no longer match.
const STRIP_DOWNSTREAM_HEADERS = [
    'content-security-policy',
    'content-security-policy-report-only',
    'clear-site-data',
    'cache-control',
    'content-encoding',
    'content-length',
]

async function buildUpstreamHeaders(req, authCodePath) {
    const header = req.headers['risu-header']
        ? JSON.parse(decodeURIComponent(req.headers['risu-header']))
        : req.headers
    if (req.headers['x-risu-tk'] && !header['x-risu-tk']) {
        header['x-risu-tk'] = req.headers['x-risu-tk']
    }
    if (req.headers['risu-location'] && !header['risu-location']) {
        header['risu-location'] = req.headers['risu-location']
    }
    if (!header['x-forwarded-for']) {
        header['x-forwarded-for'] = req.ip
    }
    // Server-register authorization swap: replace the placeholder bearer with
    // the locally-stored auth code (preserved from the legacy handler).
    if (req.headers['authorization'] && String(req.headers['authorization']).startsWith('X-SERVER-REGISTER')) {
        if (!existsSync(authCodePath)) {
            delete header['authorization']
        } else {
            const authCode = await fs.readFile(authCodePath, { encoding: 'utf-8' })
            header['authorization'] = `Bearer ${authCode}`
        }
    }
    return header
}

// Core handler. `opts.checkAuth(req, res)` must return boolean (and send its
// own error response when false) — same contract as server.cjs checkAuth.
async function handleProxy2(req, res, opts) {
    const checkAuth = opts.checkAuth
    const log = opts.logger || console
    const authCodePath = opts.authCodePath

    const requestId = nodeCrypto.randomUUID()
    // Set the request id as the very first header so even auth-failure and
    // error responses carry it — callers can correlate client + server logs.
    try { res.setHeader('x-risu-proxy-request-id', requestId) } catch { /* headers gone */ }

    const startedAt = Date.now()
    const method = req.method
    const rawUrl = req.headers['risu-url'] ? decodeURIComponent(req.headers['risu-url']) : req.query.url
    const targetLog = safeTargetForLog(rawUrl)
    const timeoutMs = getRequestTimeoutMs(req.headers)
    const idempotent = PROXY2_IDEMPOTENT_METHODS.has(method)

    let attempt = 0
    let proxyFinished = false
    let clientDisconnected = false
    let lastUpstreamStatus = null
    let lastError = null

    // One AbortController governs the upstream fetch lifetime. It fires on
    // (a) request timeout, (b) client disconnect, (c) completion cleanup.
    const controller = new AbortController()
    let abortReason = null
    let timer = null

    const onClientClose = () => {
        if (proxyFinished) return
        clientDisconnected = true
        abortReason = 'client-disconnect'
        try { controller.abort(new Error('client disconnected')) } catch { /* already aborted */ }
    }
    req.on('close', onClientClose)

    if (timeoutMs && timeoutMs > 0) {
        timer = setTimeout(() => {
            abortReason = 'timeout'
            try { controller.abort(new Error('proxy timeout')) } catch { /* already aborted */ }
        }, timeoutMs)
    }

    const cleanup = () => {
        proxyFinished = true
        if (timer) { clearTimeout(timer); timer = null }
        try { req.removeListener('close', onClientClose) } catch { /* ignore */ }
    }

    const emit = (level, msg, extra) => {
        const elapsed = Date.now() - startedAt
        const parts = [
            '[proxy2]',
            `id=${requestId}`,
            `method=${method}`,
            `target=${targetLog}`,
            `attempt=${attempt}/${PROXY2_MAX_ATTEMPTS}`,
            `elapsed=${elapsed}ms`,
        ]
        if (lastUpstreamStatus != null) parts.push(`upstreamStatus=${lastUpstreamStatus}`)
        if (clientDisconnected) parts.push(`clientClosed=1`)
        if (lastError) parts.push(`err=${lastError.name || ''}/${redactMessage(lastError.message, rawUrl, targetLog)}`)
        parts.push(msg)
        const line = parts.join(' ')
        try {
            const fn = log[level] || log.info || console.log
            fn.call(log, line, extra === undefined ? '' : extra)
        } catch { /* logging must never throw */ }
    }

    emit('info', 'reached-handler')

    if (!await checkAuth(req, res)) {
        // checkAuth sent its own response; nothing more to do.
        cleanup()
        return
    }

    if (!rawUrl) {
        sendProxyError(res, 400, 'PROXY_BAD_REQUEST', 'URL has no param', requestId)
        emit('warn', 'no-url')
        cleanup()
        return
    }

    let header
    try {
        header = await buildUpstreamHeaders(req, authCodePath)
    } catch (e) {
        lastError = e
        sendProxyError(res, 500, 'PROXY_HEADER_ERROR', 'Failed to build request headers', requestId)
        emit('error', 'header-build-failed')
        cleanup()
        return
    }

    let requestBody = undefined
    if (method !== 'GET' && method !== 'HEAD') {
        if (Buffer.isBuffer(req.body) || typeof req.body === 'string') {
            requestBody = req.body
        } else if (req.body !== undefined) {
            requestBody = JSON.stringify(req.body)
        }
    }

    try {
        let response = null
        for (attempt = 1; attempt <= PROXY2_MAX_ATTEMPTS; attempt++) {
            if (controller.signal.aborted) break
            try {
                response = await fetch(rawUrl, {
                    method,
                    headers: header,
                    body: (method === 'GET' || method === 'HEAD') ? undefined : requestBody,
                    signal: controller.signal,
                })
                lastUpstreamStatus = response.status

                // Retry transient upstream statuses ONLY for idempotent methods.
                if (idempotent
                    && PROXY2_TRANSIENT_STATUS.has(response.status)
                    && attempt < PROXY2_MAX_ATTEMPTS
                    && !controller.signal.aborted) {
                    // Release the response body before retrying.
                    try { await response.body?.cancel?.() } catch { /* ignore */ }
                    emit('warn', `transient-status=${response.status} retrying`)
                    await abortableSleep(PROXY2_BACKOFF_MS[attempt - 1] ?? 400, controller.signal)
                    response = null
                    continue
                }
                break
            } catch (err) {
                lastError = err
                // Our own timeout/client-disconnect abort: stop immediately.
                if (err?.name === 'AbortError' || controller.signal.aborted) {
                    throw err
                }
                if (idempotent && isTransientError(err) && attempt < PROXY2_MAX_ATTEMPTS) {
                    emit('warn', `transient-error retrying`)
                    await abortableSleep(PROXY2_BACKOFF_MS[attempt - 1] ?? 400, controller.signal)
                    response = null
                    continue
                }
                throw err
            }
        }

        if (!response) {
            // Retries exhausted on transient failures (idempotent only).
            const code = 'PROXY_UPSTREAM_NETWORK_ERROR'
            sendProxyError(res, 502, code, 'Proxy upstream request failed', requestId, { attempts: attempt })
            emit('error', 'exhausted-retries')
            return
        }

        // Successful upstream response at the HTTP transport level. Preserve
        // the upstream status (even non-2xx) and stream the body without buffering.
        const head = new Headers(response.headers)
        for (const h of STRIP_DOWNSTREAM_HEADERS) head.delete(h)
        const headObj = {}
        for (const [k, v] of head) headObj[k] = v
        headObj['x-risu-proxy-request-id'] = requestId
        res.header(headObj)
        res.status(response.status)
        emit('info', `streaming status=${response.status}`)
        await pipeline(response.body, res)
        emit('info', 'done')
    } catch (err) {
        lastError = err
        if (err?.name === 'AbortError' || controller.signal.aborted) {
            if (clientDisconnected) {
                emit('warn', 'client-disconnected')
                if (!res.headersSent) {
                    try { res.status(499).end() } catch { /* client gone */ }
                } else {
                    try { res.end() } catch { /* client gone */ }
                }
            } else {
                // Timeout (no client disconnect observed).
                emit('warn', 'timeout')
                sendProxyError(res, 504, 'PROXY_TIMEOUT',
                    timeoutMs ? `Proxy request timed out after ${timeoutMs}ms` : 'Proxy request aborted',
                    requestId)
            }
            return
        }
        // Non-idempotent transport failure, or an unexpected error.
        emit('error', 'upstream-error')
        sendProxyError(res, 502, 'PROXY_UPSTREAM_NETWORK_ERROR', 'Proxy upstream request failed', requestId)
    } finally {
        cleanup()
    }
}

function registerProxy2Routes(app, opts) {
    const handler = (req, res, next) => {
        Promise.resolve().then(() => handleProxy2(req, res, opts)).catch(next)
    }
    // /proxy2 is the production endpoint; legacy /proxy is kept on the same
    // hardened handler so both proxy paths benefit from the fix.
    for (const m of ['get', 'post', 'put', 'patch', 'delete']) {
        app[m]('/proxy2', handler)
        app[m]('/proxy', handler)
    }
    return handler
}

module.exports = {
    handleProxy2,
    registerProxy2Routes,
    // Exported for unit testing.
    PROXY2_MAX_ATTEMPTS,
    PROXY2_BACKOFF_MS,
    PROXY2_TRANSIENT_STATUS,
    PROXY2_IDEMPOTENT_METHODS,
    safeTargetForLog,
    redactMessage,
    isTransientError,
    getRequestTimeoutMs,
}