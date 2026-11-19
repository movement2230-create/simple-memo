// 메일 목록 화면에서 "제목"만 읽어 확장 프로그램 백그라운드로 넘깁니다.
// 본문·보낸 사람·첨부는 읽지 않으며, 어떤 서버로도 보내지 않습니다.
// 사용자가 확장 프로그램 팝업에서 켠 메일 사이트에서만 실행됩니다.
(() => {
  if (window.__mailTodoLoaded) return;
  window.__mailTodoLoaded = true;

  const SITE = location.hostname;
  const isTop = window === window.top;
  const sentInPage = new Set();
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);

  // ---------- 1) 메일 서비스별 전용 읽기 ----------
  const ADAPTERS = [
    {
      // Gmail: 목록 한 줄 = tr.zA, 제목 = .bog
      test: (h) => h === 'mail.google.com',
      collect: () => [...document.querySelectorAll('tr.zA')].map((row) => {
        const s = row.querySelector('.bog');
        if (!s) return null;
        const id = row.querySelector('[data-legacy-thread-id]')?.getAttribute('data-legacy-thread-id');
        return { subject: clean(s.textContent), link: id ? `${location.href.split('#')[0]}#all/${id}` : '' };
      }),
    },
  ];

  // ---------- 2) 자동 추측: 이름에 subject/title이 들어간 요소가 여러 개 반복되면 제목 목록으로 봄 ----------
  const SUBJECT_SELECTORS = [
    '[class*="subject" i]', '[data-testid*="subject" i]', '[id*="subject" i]',
    '[class*="mail_title" i]', '[class*="mailtitle" i]', '[class*="tit_subject" i]',
    '[class*="mail-title" i]', '[class*="msg_title" i]',
  ];

  function heuristic() {
    for (const sel of SUBJECT_SELECTORS) {
      let els = [...document.querySelectorAll(sel)].filter((el) =>
        visible(el) && !el.closest('nav, aside, header, [role="navigation"], [contenteditable="true"], input, textarea'));
      // 겹친 요소(제목 안의 제목 텍스트)는 가장 안쪽만 남김
      els = els.filter((el) => !els.some((o) => o !== el && el.contains(o)));
      const groups = new Map();
      for (const el of els) {
        const k = signature(el);
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(el);
      }
      const best = [...groups.values()].sort((a, b) => b.length - a.length)[0];
      if (best && best.length >= 3) {
        return best.map((el) => ({ subject: clean(el.textContent), link: el.closest('a[href]')?.href || '' }));
      }
    }
    return [];
  }

  // ---------- 3) 사용자가 직접 지정한 목록 ----------
  // 읽음/안읽음·선택 상태에 따라 바뀌는 클래스는 빼고, 첫 번째 클래스만 사용
  const STATE_CLASS = /^is-|^has-|(^|[-_])(active|selected|hover|focus|focused|unread|read|checked|new|on|open|current)($|[-_])/i;
  function signature(el) {
    let s = el.tagName.toLowerCase();
    const role = el.getAttribute('role');
    if (role) s += `[role="${CSS.escape(role)}"]`;
    const cls = [...el.classList].find((c) => !STATE_CLASS.test(c) && !/\d{4,}/.test(c));
    if (cls) s += `.${CSS.escape(cls)}`;
    return s;
  }

  // 클릭한 제목에서 위로 올라가며, 같은 모양의 형제가 3개 이상인 "목록 한 줄"을 찾음
  function findRow(el) {
    for (let a = el.parentElement ? el : null; a && a !== document.body; a = a.parentElement) {
      const p = a.parentElement;
      if (!p) break;
      if (a === el) continue; // 제목 자체가 아니라 그것을 감싼 줄이어야 함
      const sig = signature(a);
      const same = [...p.children].filter((c) => signature(c) === sig);
      if (same.length >= 3 && clean(a.textContent).length > clean(el.textContent).length) return a;
    }
    return null;
  }

  function chainFrom(row, el) {
    const parts = [];
    for (let n = el; n && n !== row; n = n.parentElement) parts.unshift(signature(n));
    return parts.join(' > ');
  }

  function collectPicked(p) {
    let rows;
    try { rows = document.querySelectorAll(p.row); } catch { return []; }
    const out = [];
    for (const row of rows) {
      let s = null;
      try { s = row.querySelector(`:scope > ${p.subject}`); } catch { return []; }
      if (!s) continue;
      out.push({ subject: clean(s.textContent), link: s.closest('a[href]')?.href || row.querySelector('a[href]')?.href || '' });
    }
    return out;
  }

  // ---------- 읽기 ----------
  async function collect() {
    const { pickers = {} } = await chrome.storage.local.get('pickers');
    let items = [];
    if (pickers[SITE]) items = collectPicked(pickers[SITE]);
    if (!items.length) {
      const ad = ADAPTERS.find((a) => a.test(SITE));
      if (ad) items = ad.collect().filter(Boolean);
    }
    if (!items.length) items = heuristic();
    return items.filter((i) => i.subject && i.subject.length >= 2);
  }

  async function scan(force) {
    const items = await collect();
    const fresh = items.filter((i) => force || !sentInPage.has(i.subject));
    fresh.forEach((i) => sentInPage.add(i.subject));
    let added = 0;
    if (fresh.length) {
      const res = await chrome.runtime.sendMessage({ type: 'subjects', site: SITE, items: fresh });
      added = res?.added || 0;
    }
    return { found: items.length, added };
  }

  // 목록이 바뀌면(새 메일, 페이지 이동) 잠시 뒤 다시 읽기
  let timer = null;
  const observer = new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (document.hidden || picking) return;
      scan(false).catch(stopIfOrphaned);
    }, 2000);
  });
  function stopIfOrphaned() {
    // 확장 프로그램을 다시 로드하면 이 페이지의 옛 스크립트는 더 이상 쓸 수 없음
    if (!chrome.runtime?.id) observer.disconnect();
  }
  observer.observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(() => scan(false).catch(stopIfOrphaned), 1500);

  // ---------- 목록 직접 지정 모드 ----------
  let picking = false;
  let box = null;
  let banner = null;

  function startPick() {
    if (picking) return;
    picking = true;
    box = document.createElement('div');
    box.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;border:2px solid #e0a526;background:rgba(224,165,38,.15);border-radius:4px;transition:all .05s';
    banner = document.createElement('div');
    banner.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483647;background:#1f1f1d;color:#fff;font:14px system-ui,"Malgun Gothic",sans-serif;padding:10px 16px;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.3)';
    banner.textContent = '메일 목록에서 제목 하나를 클릭하세요 (Esc: 취소)';
    document.documentElement.append(box, banner);
    window.addEventListener('mouseover', onOver, true);
    window.addEventListener('click', onClick, true);
    window.addEventListener('keydown', onKey, true);
  }

  function endPick(message) {
    picking = false;
    window.removeEventListener('mouseover', onOver, true);
    window.removeEventListener('click', onClick, true);
    window.removeEventListener('keydown', onKey, true);
    box?.remove();
    box = null;
    if (message && banner) {
      banner.textContent = message;
      setTimeout(() => banner?.remove(), 2500);
    } else {
      banner?.remove();
    }
  }

  function onOver(e) {
    const r = e.target.getBoundingClientRect();
    Object.assign(box.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
  }

  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); endPick('취소했어요'); }
  }

  async function onClick(e) {
    e.preventDefault();
    e.stopPropagation();
    const el = e.target;
    const row = findRow(el);
    if (!row) {
      banner.textContent = '목록을 찾지 못했어요. 다른 메일의 제목을 클릭해 보세요 (Esc: 취소)';
      return;
    }
    const picker = { row: signature(row), subject: chainFrom(row, el) };
    const found = collectPicked(picker);
    if (found.length < 2) {
      banner.textContent = '제목을 하나만 찾았어요. 다른 제목을 클릭해 보세요 (Esc: 취소)';
      return;
    }
    await chrome.runtime.sendMessage({ type: 'picker:save', site: SITE, picker });
    // 찾은 제목을 잠깐 표시
    const marks = [...document.querySelectorAll(picker.row)]
      .map((r) => r.querySelector(`:scope > ${picker.subject}`)).filter(Boolean);
    marks.forEach((m) => { m.dataset.mailTodoOutline = m.style.outline; m.style.outline = '2px solid #2e9d5b'; });
    setTimeout(() => marks.forEach((m) => { m.style.outline = m.dataset.mailTodoOutline || ''; delete m.dataset.mailTodoOutline; }), 2500);
    const res = await scan(true);
    endPick(`제목 ${found.length}개를 찾았어요. 새 할 일 ${res.added}개`);
  }

  // 다른 프레임에서 지정을 마치면 여기서도 지정 모드 종료
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.pickers && picking) endPick();
  });

  // ---------- 팝업에서 오는 요청 ----------
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'scan') {
      scan(true).then((r) => {
        // 프레임이 여러 개면 제목을 찾은 프레임이 답하고, 맨 위 프레임은 조금 기다렸다 답함
        if (r.found > 0) sendResponse(r);
        else if (isTop) setTimeout(() => sendResponse(r), 800);
      }).catch((e) => isTop && sendResponse({ found: 0, added: 0, error: String(e) }));
      return true;
    }
    if (msg?.type === 'pick') {
      startPick();
      if (isTop) sendResponse({ ok: true });
      return false;
    }
    return false;
  });
})();
