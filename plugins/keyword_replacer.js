//@name keyword_replacer
//@display-name 키워드 교체
//@api 3.0
//@version 1.0.0
//@arg enabled int {{checkbox::사용}} {{name::활성화}}
//@arg rules string {{textarea}} {{name::교체 규칙}} 한 줄에 하나씩 "찾을말=>바꿀말" 형식. 정규식은 "/패턴/플래그=>바꿀말". #으로 시작하면 주석.

// 채팅 출력물(표시 단계) 전체에서 키워드를 교체합니다.
// 아래 구간은 치환하지 않습니다.
//  - <div class="am-illustration-projection"> ... </div> 블록 전체
//  - HTML 태그 자체(속성값 포함), <!-- 주석 -->, <style>/<script> 내용
//  - {{...}} CBS 구문

(async () => {
  const ILLUST_OPEN = /<div\b[^>]*\bclass\s*=\s*(["'])[^"']*\bam-illustration-projection\b[^"']*\1[^>]*>/gi;
  const DIV_TAG = /<\/?div\b[^>]*>/gi;
  const RAW_BLOCK = /<!--[\s\S]*?-->|<(style|script)\b[^>]*>[\s\S]*?<\/\1\s*>|<\/?[a-zA-Z][^>]*>/g;

  const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // ---------- 규칙 파싱 ----------
  let cachedSource = null;
  let cachedRules = null;

  const parseRules = (source) => {
    const plain = [];
    const regexes = [];
    for (const rawLine of String(source || '').split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const idx = line.indexOf('=>');
      if (idx <= 0) continue;
      const from = line.slice(0, idx).trim();
      const to = line.slice(idx + 2).trim();
      if (!from) continue;

      const re = /^\/(.+)\/([a-z]*)$/.exec(from);
      if (re) {
        try {
          const flags = re[2].includes('g') ? re[2] : re[2] + 'g';
          regexes.push({ re: new RegExp(re[1], flags), to });
        } catch (e) {
          console.log(`[keyword_replacer] 잘못된 정규식: ${from} (${e.message})`);
        }
      } else {
        plain.push({ from, to });
      }
    }

    // 일반 키워드는 한 번에 치환해서 연쇄 치환(A=>B, B=>C)을 막고, 긴 키워드를 우선 매칭
    let plainRe = null;
    const plainMap = new Map();
    if (plain.length) {
      plain.sort((a, b) => b.from.length - a.from.length);
      for (const p of plain) if (!plainMap.has(p.from)) plainMap.set(p.from, p.to);
      plainRe = new RegExp([...plainMap.keys()].map(escapeRegex).join('|'), 'g');
    }
    return { plainRe, plainMap, regexes };
  };

  const getRules = async () => {
    const source = (await Risuai.getArgument('rules')) ?? '';
    if (source !== cachedSource) {
      cachedSource = source;
      cachedRules = parseRules(source);
    }
    return cachedRules;
  };

  // ---------- 보호 구간 계산 ----------
  // 일러스트 div 블록: 중첩 div를 세어서 짝이 맞는 </div>까지 보호
  const findIllustrationRanges = (text) => {
    const ranges = [];
    ILLUST_OPEN.lastIndex = 0;
    let m;
    while ((m = ILLUST_OPEN.exec(text))) {
      const start = m.index;
      let depth = 1;
      let end = text.length; // 닫는 태그가 없으면 끝까지 보호
      DIV_TAG.lastIndex = ILLUST_OPEN.lastIndex;
      let t;
      while ((t = DIV_TAG.exec(text))) {
        depth += t[0][1] === '/' ? -1 : 1;
        if (depth === 0) {
          end = DIV_TAG.lastIndex;
          break;
        }
      }
      ranges.push([start, end]);
      ILLUST_OPEN.lastIndex = end;
    }
    return ranges;
  };

  // {{ ... }} CBS 구문 (중첩 포함)
  const findCbsRanges = (text) => {
    const ranges = [];
    let i = 0;
    while ((i = text.indexOf('{{', i)) !== -1) {
      let depth = 0;
      let j = i;
      let end = -1;
      while (j < text.length - 1) {
        if (text[j] === '{' && text[j + 1] === '{') { depth++; j += 2; continue; }
        if (text[j] === '}' && text[j + 1] === '}') {
          depth--; j += 2;
          if (depth === 0) { end = j; break; }
          continue;
        }
        j++;
      }
      if (end === -1) break;
      ranges.push([i, end]);
      i = end;
    }
    return ranges;
  };

  const findTagRanges = (text) => {
    const ranges = [];
    RAW_BLOCK.lastIndex = 0;
    let m;
    while ((m = RAW_BLOCK.exec(text))) ranges.push([m.index, m.index + m[0].length]);
    return ranges;
  };

  const mergeRanges = (ranges) => {
    ranges.sort((a, b) => a[0] - b[0]);
    const out = [];
    for (const r of ranges) {
      const last = out[out.length - 1];
      if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
      else out.push([r[0], r[1]]);
    }
    return out;
  };

  // ---------- 치환 ----------
  const replaceSegment = (seg, rules) => {
    if (rules.plainRe) seg = seg.replace(rules.plainRe, (k) => rules.plainMap.get(k));
    for (const r of rules.regexes) {
      r.re.lastIndex = 0;
      seg = seg.replace(r.re, r.to);
    }
    return seg;
  };

  const handler = async (content) => {
    if (typeof content !== 'string' || !content) return content;
    const enabled = await Risuai.getArgument('enabled');
    if (!Number(enabled)) return content;

    const rules = await getRules();
    if (!rules.plainRe && !rules.regexes.length) return content;

    const protectedRanges = mergeRanges([
      ...findIllustrationRanges(content),
      ...findCbsRanges(content),
      ...findTagRanges(content),
    ]);

    let out = '';
    let pos = 0;
    for (const [s, e] of protectedRanges) {
      if (s > pos) out += replaceSegment(content.slice(pos, s), rules);
      out += content.slice(s, e);
      pos = e;
    }
    if (pos < content.length) out += replaceSegment(content.slice(pos), rules);
    return out;
  };

  try {
    await Risuai.addRisuScriptHandler('display', handler);
    console.log('[keyword_replacer] 로드 완료');
  } catch (e) {
    console.log(`[keyword_replacer] 초기화 실패: ${e.message}`);
  }
})();
