//@name openrouter_credits
//@display-name OpenRouter Credits
//@api 3.0
//@version 1.0.0
//@arg api_key string {{name::OpenRouter API 키}}{{placeholder::sk-or-v1-...}} 잔량을 조회할 OpenRouter API 키 (RisuAI 본 설정의 키는 플러그인에서 읽을 수 없어 따로 입력해야 합니다)
//@arg refresh_seconds int {{name::자동 갱신 주기 (초)}} 0이면 60초, 최소 10초. AI 응답이 끝날 때마다 추가로 갱신합니다
//@arg low_threshold string {{name::경고 기준 잔량 ($)}}{{placeholder::1}} 잔량이 이 금액 아래면 주황색, 0 이하면 빨간색으로 표시합니다 (기본 1)
//@arg display string {{name::표시 위치}}{{radio::화면 배지|badge,채팅 메뉴|chat,햄버거 메뉴|hamburger}} 화면 배지는 메인 화면 접근 권한이 필요합니다
//@arg badge_position string {{name::배지 위치}}{{radio::채팅 영역 왼쪽 위|top-left,채팅 영역 오른쪽 위|top-right,채팅 영역 왼쪽 아래|bottom-left,채팅 영역 오른쪽 아래|bottom-right}} 배지는 채팅 영역 안에만 표시됩니다
//@link https://openrouter.ai/settings/credits OpenRouter 크레딧 페이지

(async () => {
  const API_BASE = 'https://openrouter.ai/api/v1';
  const UI_ID = 'openrouter-credits-ui';
  const SETTING_ID = 'openrouter-credits-setting';
  const AFTER_OUTPUT_DELAY = 4000;

  /** @type {{credits: any, key: any, error: string|null, fetchedAt: number|null, loading: boolean}} */
  const state = { credits: null, key: null, error: null, fetchedAt: null, loading: false };

  let timer = null;
  let badgeWatcher = null;
  let outputDebounce = null;
  let badge = null;
  let panelOpen = false;
  let currentDisplay = null;

  const getConfig = async () => {
    const apiKey = String((await Risuai.getArgument('api_key')) ?? '').trim();
    let refresh = Number(await Risuai.getArgument('refresh_seconds')) || 60;
    refresh = Math.max(10, refresh);
    const thresholdRaw = String((await Risuai.getArgument('low_threshold')) ?? '').trim();
    const threshold = thresholdRaw === '' ? 1 : Number(thresholdRaw);
    const display = String((await Risuai.getArgument('display')) || 'badge');
    const position = String((await Risuai.getArgument('badge_position')) || 'top-left');
    return {
      apiKey,
      refresh,
      threshold: Number.isFinite(threshold) ? threshold : 1,
      display,
      position,
    };
  };

  const formatUsd = (value) => {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return '-';
    const n = Number(value);
    const digits = Math.abs(n) < 0.01 && n !== 0 ? 4 : 2;
    return `$${n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
  };

  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);

  // Remaining balance: account credits if the key may read them, otherwise the key's own spending limit.
  const getRemaining = () => {
    if (state.credits) {
      return { value: state.credits.total_credits - state.credits.total_usage, source: 'account' };
    }
    if (state.key && state.key.limit_remaining !== null && state.key.limit_remaining !== undefined) {
      return { value: state.key.limit_remaining, source: 'key' };
    }
    return null;
  };

  const requestJson = async (path, apiKey) => {
    const res = await Risuai.nativeFetch(`${API_BASE}${path}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    let body = null;
    try {
      body = await res.json();
    } catch (e) {
      body = null;
    }
    if (!res.ok) {
      const msg = body?.error?.message || `HTTP ${res.status}`;
      const err = new Error(msg);
      err.status = res.status;
      throw err;
    }
    return body?.data ?? body;
  };

  const refresh = async () => {
    const config = await getConfig();
    if (!config.apiKey) {
      state.error = 'API 키가 설정되지 않았습니다. 플러그인 설정에서 OpenRouter API 키를 입력하세요.';
      state.credits = null;
      state.key = null;
      await render();
      return;
    }
    if (state.loading) return;
    state.loading = true;
    await render();

    const [creditsRes, keyRes] = await Promise.allSettled([
      requestJson('/credits', config.apiKey),
      requestJson('/key', config.apiKey),
    ]);

    state.credits = creditsRes.status === 'fulfilled' ? creditsRes.value : null;
    state.key = keyRes.status === 'fulfilled' ? keyRes.value : null;

    if (!state.credits && !state.key) {
      const reason = keyRes.reason || creditsRes.reason;
      state.error = reason?.status === 401
        ? 'API 키가 올바르지 않습니다 (401).'
        : `조회 실패: ${reason?.message || '알 수 없는 오류'}`;
    } else {
      state.error = null;
      state.fetchedAt = Date.now();
    }
    state.loading = false;
    await render();
  };

  // ---------- Compact display (badge / menu entry) ----------

  const summaryText = () => {
    if (state.error && !state.fetchedAt) return 'OpenRouter: 오류';
    const remaining = getRemaining();
    if (remaining) return `OpenRouter ${formatUsd(remaining.value)}`;
    if (state.key) return `OpenRouter 사용 ${formatUsd(state.key.usage)}`;
    return 'OpenRouter …';
  };

  const levelColor = (threshold) => {
    if (state.error) return '#9ca3af';
    const remaining = getRemaining();
    if (!remaining) return '#60a5fa';
    if (remaining.value <= 0) return '#ef4444';
    if (remaining.value < threshold) return '#f97316';
    return '#22c55e';
  };

  // Offsets inside the chat area (the wrapper around .default-chat-screen), not the viewport,
  // so the badge never sits on top of the sidebar or app header.
  const POSITIONS = {
    'top-left': 'top: 8px; left: 8px;',
    'top-right': 'top: 8px; right: 8px;',
    'bottom-left': 'bottom: 80px; left: 8px;',
    'bottom-right': 'bottom: 80px; right: 8px;',
  };
  const BADGE_SELECTOR = '[x-openrouter-credits]';
  const CHAT_SELECTOR = '.default-chat-screen';
  const BADGE_WATCH_MS = 1500;

  let rootDoc = null;
  let badgeDenied = false;
  let badgeHtml = '';
  // Renders can overlap (timer, AI output, watcher), so attaching is shared through one promise.
  let attachPromise = null;

  const getRoot = async () => {
    if (rootDoc || badgeDenied) return rootDoc;
    rootDoc = await Risuai.getRootDocument();
    if (!rootDoc) badgeDenied = true;
    return rootDoc;
  };

  // The chat screen is re-mounted when switching characters or screens, taking the badge with it,
  // so every call checks the live DOM and re-attaches when needed. Returns null when no chat is shown.
  const attachBadge = (position) => {
    if (!attachPromise) {
      attachPromise = doAttachBadge(position).finally(() => { attachPromise = null; });
    }
    return attachPromise;
  };

  const doAttachBadge = async (position) => {
    const doc = await getRoot();
    if (!doc) return null;
    const live = await doc.querySelector(BADGE_SELECTOR);
    if (live) {
      badge = live;
      return live;
    }
    badge = null;
    badgeHtml = '';
    const chat = await doc.querySelector(CHAT_SELECTOR);
    const area = chat ? await chat.getParent() : null;
    if (!area) return null;
    const el = await doc.createElement('div');
    await el.setAttribute('x-openrouter-credits', '1');
    await el.setStyleAttribute(
      `position: absolute; ${POSITIONS[position] || POSITIONS['top-left']} z-index: 35;` +
      'padding: 3px 9px; border-radius: 999px; font-size: 12px; font-weight: 600;' +
      'font-family: ui-monospace, SFMono-Regular, Menlo, monospace; cursor: pointer;' +
      'background: rgba(17, 24, 39, 0.8); color: #f9fafb; border: 1px solid rgba(255,255,255,0.15);' +
      'box-shadow: 0 2px 6px rgba(0,0,0,0.25); user-select: none; pointer-events: auto;'
    );
    await el.addEventListener('click', () => { openPanel(); });
    await area.appendChild(el);
    badge = el;
    return el;
  };

  const removeBadge = async () => {
    const doc = rootDoc;
    badge = null;
    badgeHtml = '';
    if (!doc) return;
    try {
      const live = await doc.querySelector(BADGE_SELECTOR);
      if (live) await live.remove();
    } catch (e) { /* already gone */ }
  };

  const renderCompact = async () => {
    const config = await getConfig();
    let display = config.display;

    if (display === 'badge') {
      const doc = await getRoot();
      if (doc) {
        if (currentDisplay && currentDisplay !== 'badge') await Risuai.unregisterUIPart(UI_ID);
        currentDisplay = 'badge';
        const el = await attachBadge(config.position);
        if (!el) return;
        const dot = state.loading ? '◌' : '●';
        const html = `<span style="color:${levelColor(config.threshold)}">${dot}</span> ${escapeHtml(summaryText())}`;
        if (html !== badgeHtml) {
          badgeHtml = html;
          await el.setInnerHTML(html);
        }
        return;
      }
      // Main DOM permission denied: fall back to the chat menu.
      display = 'chat';
    }

    await removeBadge();
    if (currentDisplay !== display && currentDisplay && currentDisplay !== 'badge') {
      await Risuai.unregisterUIPart(UI_ID);
    }
    currentDisplay = display;
    await Risuai.registerButton({
      name: summaryText(),
      icon: '💳',
      iconType: 'html',
      location: display === 'hamburger' ? 'hamburger' : 'chat',
      id: UI_ID,
    }, () => { openPanel(); });
  };

  // ---------- Detail panel (plugin iframe) ----------

  const row = (label, value) =>
    `<div class="row"><span class="label">${escapeHtml(label)}</span><span class="value">${escapeHtml(value)}</span></div>`;

  const renderPanel = async () => {
    if (!panelOpen) return;
    const config = await getConfig();
    const remaining = getRemaining();
    const color = levelColor(config.threshold);

    let scheme = null;
    try { scheme = (await Risuai.getColorScheme())?.scheme; } catch (e) { scheme = null; }
    const bg = scheme?.bgcolor || '#111827';
    const card = scheme?.darkbg || '#1f2937';
    const border = scheme?.borderc || '#374151';
    const text = scheme?.textcolor || '#f9fafb';
    const text2 = scheme?.textcolor2 || '#9ca3af';
    const accent = scheme?.selected || '#3b82f6';

    let sections = '';
    if (state.credits) {
      sections += `<div class="card"><h2>계정 크레딧</h2>
        ${row('구매한 크레딧', formatUsd(state.credits.total_credits))}
        ${row('사용한 크레딧', formatUsd(state.credits.total_usage))}
        ${row('남은 크레딧', formatUsd(state.credits.total_credits - state.credits.total_usage))}
      </div>`;
    }
    if (state.key) {
      const k = state.key;
      sections += `<div class="card"><h2>API 키${k.label ? ` · ${escapeHtml(k.label)}` : ''}</h2>
        ${row('키 사용 한도', k.limit === null || k.limit === undefined ? '무제한' : formatUsd(k.limit))}
        ${k.limit_remaining !== null && k.limit_remaining !== undefined ? row('한도 잔여', formatUsd(k.limit_remaining)) : ''}
        ${k.limit_reset ? row('한도 초기화', String(k.limit_reset)) : ''}
        ${row('누적 사용', formatUsd(k.usage))}
        ${k.usage_daily !== undefined ? row('오늘 사용 (UTC)', formatUsd(k.usage_daily)) : ''}
        ${k.usage_weekly !== undefined ? row('이번 주 사용', formatUsd(k.usage_weekly)) : ''}
        ${k.usage_monthly !== undefined ? row('이번 달 사용', formatUsd(k.usage_monthly)) : ''}
        ${row('무료 등급', k.is_free_tier ? '예' : '아니오')}
      </div>`;
    }
    if (state.key && !state.credits) {
      sections += `<p class="note">이 키로는 계정 전체 크레딧(/credits)을 읽을 수 없어 키 한도 기준으로 표시합니다.</p>`;
    }

    const big = remaining ? formatUsd(remaining.value) : (state.key ? formatUsd(state.key.usage) : '-');
    const bigLabel = remaining
      ? (remaining.source === 'account' ? '남은 크레딧' : '키 한도 잔여')
      : (state.key ? '누적 사용 (잔량 정보 없음)' : '잔량');
    const updated = state.fetchedAt ? new Date(state.fetchedAt).toLocaleTimeString() : '-';

    document.body.innerHTML = `
      <style>
        * { box-sizing: border-box; }
        body { margin: 0; background: ${bg}; color: ${text}; font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; }
        .wrap { max-width: 480px; margin: 0 auto; padding: 24px 16px 40px; }
        header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
        h1 { font-size: 18px; margin: 0; }
        h2 { font-size: 13px; margin: 0 0 8px; color: ${text2}; font-weight: 600; }
        .hero { background: ${card}; border: 1px solid ${border}; border-radius: 12px; padding: 20px; text-align: center; margin-bottom: 12px; }
        .hero .amount { font-size: 36px; font-weight: 700; color: ${color}; font-variant-numeric: tabular-nums; }
        .hero .sub { font-size: 12px; color: ${text2}; margin-top: 4px; }
        .card { background: ${card}; border: 1px solid ${border}; border-radius: 12px; padding: 14px 16px; margin-bottom: 12px; }
        .row { display: flex; justify-content: space-between; padding: 5px 0; font-size: 14px; }
        .row + .row { border-top: 1px solid ${border}; }
        .label { color: ${text2}; }
        .value { font-variant-numeric: tabular-nums; }
        .error { background: rgba(239,68,68,0.12); border: 1px solid rgba(239,68,68,0.4); color: #fca5a5; border-radius: 10px; padding: 10px 12px; font-size: 13px; margin-bottom: 12px; }
        .note { font-size: 12px; color: ${text2}; }
        .actions { display: flex; gap: 8px; margin-top: 16px; }
        button { flex: 1; padding: 10px; border-radius: 8px; border: 1px solid ${border}; background: ${card}; color: ${text}; font-size: 14px; cursor: pointer; }
        button.primary { background: ${accent}; border-color: ${accent}; color: #fff; }
        button:disabled { opacity: 0.6; cursor: default; }
        .close { flex: none; width: 36px; height: 36px; padding: 0; font-size: 18px; }
        a { color: ${accent}; }
      </style>
      <div class="wrap">
        <header>
          <h1>OpenRouter 크레딧</h1>
          <button class="close" id="orc-close" aria-label="닫기">✕</button>
        </header>
        ${state.error ? `<div class="error">${escapeHtml(state.error)}</div>` : ''}
        <div class="hero">
          <div class="amount">${escapeHtml(big)}</div>
          <div class="sub">${escapeHtml(bigLabel)} · 마지막 갱신 ${escapeHtml(updated)} · ${config.refresh}초마다 자동 갱신</div>
        </div>
        ${sections}
        <p class="note">OpenRouter의 사용량 집계는 요청 후 수 초~수십 초 늦게 반영될 수 있습니다.
          충전은 플러그인 설정의 링크(openrouter.ai/settings/credits)에서 할 수 있습니다.</p>
        <div class="actions">
          <button class="primary" id="orc-refresh" ${state.loading ? 'disabled' : ''}>${state.loading ? '조회 중…' : '지금 갱신'}</button>
        </div>
      </div>
    `;
    document.getElementById('orc-close').addEventListener('click', closePanel);
    document.getElementById('orc-refresh').addEventListener('click', () => { refresh(); });
  };

  const openPanel = async () => {
    panelOpen = true;
    await renderPanel();
    await Risuai.showContainer('fullscreen');
    refresh();
  };

  const closePanel = async () => {
    panelOpen = false;
    await Risuai.hideContainer();
  };

  const render = async () => {
    try {
      await renderCompact();
      await renderPanel();
    } catch (e) {
      console.log(`render error: ${e?.message || e}`);
    }
  };

  // ---------- Scheduling ----------

  const schedule = async () => {
    if (timer) clearInterval(timer);
    const { refresh: seconds } = await getConfig();
    timer = setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      refresh();
    }, seconds * 1000);

    // DOM-only check (no network) that puts the badge back after the chat screen re-mounts.
    if (badgeWatcher) clearInterval(badgeWatcher);
    badgeWatcher = setInterval(() => {
      if (document.visibilityState === 'hidden' || currentDisplay !== 'badge') return;
      renderCompact().catch(() => {});
    }, BADGE_WATCH_MS);
  };

  // Re-check shortly after each AI response, since that is when the balance changes.
  const onOutput = (content) => {
    if (outputDebounce) clearTimeout(outputDebounce);
    outputDebounce = setTimeout(() => { refresh(); }, AFTER_OUTPUT_DELAY);
    return content;
  };

  const onVisible = () => {
    if (document.visibilityState === 'visible') refresh();
  };

  try {
    await Risuai.registerSetting('OpenRouter 크레딧', () => { openPanel(); }, '💳', 'html', SETTING_ID);
    await Risuai.addRisuScriptHandler('output', onOutput);
    document.addEventListener('visibilitychange', onVisible);

    await Risuai.onUnload(async () => {
      if (timer) clearInterval(timer);
      if (badgeWatcher) clearInterval(badgeWatcher);
      if (outputDebounce) clearTimeout(outputDebounce);
      document.removeEventListener('visibilitychange', onVisible);
      try { await Risuai.removeRisuScriptHandler('output', onOutput); } catch (e) { /* ignore */ }
      await removeBadge();
    });

    await schedule();
    await refresh();
  } catch (error) {
    console.log(`Error: ${error?.message || error}`);
  }
})();
