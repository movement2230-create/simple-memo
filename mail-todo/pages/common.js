// 사이드 패널과 큰 화면(dashboard)이 함께 쓰는 화면 도우미
import { addDays, parseYmd, ymd } from '../src/rules.js';
import { listMailboxes, mailboxOf } from '../src/mailboxes.js';

export const $ = (id) => document.getElementById(id);
export const send = (msg) => chrome.runtime.sendMessage(msg);
export const PRIORITY_LABEL = { high: '높음', normal: '보통', low: '낮음' };
const PRIORITY_ORDER = { high: 0, normal: 1, low: 2 };

// 사용자 데이터(메일 제목 등)는 항상 textContent로만 넣습니다.
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'text') el.textContent = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c);
  return el;
}

// ---------- 데이터 ----------
export const state = { todos: [], settings: {}, sites: [] };

export async function load() {
  const d = await chrome.storage.local.get(['todos', 'settings', 'sites']);
  state.todos = d.todos || [];
  state.settings = d.settings || {};
  state.sites = d.sites || [];
  return state;
}

export const update = (id, patch) => send({ type: 'todo:update', id, patch });
export const toggleDone = (t) => update(t.id, { done: !t.done });

// ---------- 날짜·정렬 ----------
export const today = () => ymd(new Date());
export const isOverdue = (t) => !t.done && t.due && t.due < today();

export function sortTodos(list) {
  return [...list].sort((a, b) =>
    (a.done - b.done)
    || (a.due || '9999').localeCompare(b.due || '9999')
    || (a.dueTime || '99').localeCompare(b.dueTime || '99')
    || PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]
    || a.createdAt.localeCompare(b.createdAt));
}

export function formatDue(t, { short = false } = {}) {
  if (!t.due) return '마감일 없음';
  const d = parseYmd(t.due);
  const diff = Math.round((d - parseYmd(today())) / 86400000);
  const rel = diff === 0 ? '오늘' : diff === 1 ? '내일' : diff === -1 ? '어제' : diff < 0 ? `${-diff}일 지남` : `${diff}일 남음`;
  const wd = '일월화수목금토'[d.getDay()];
  const date = `${d.getMonth() + 1}/${d.getDate()}(${wd})${t.dueTime ? ' ' + t.dueTime : ''}`;
  return short && Math.abs(diff) <= 1 ? `${rel}${t.dueTime ? ' ' + t.dueTime : ''}` : `${date} · ${rel}`;
}

// 목록 묶음: 지난 마감 / 오늘 / 7일 안 / 나중에 / 마감일 없음 / 완료
export function groupTodos(list) {
  const todayStr = today();
  const weekEnd = ymd(addDays(new Date(), 7));
  return [
    ['지난 마감', (t) => !t.done && t.due && t.due < todayStr, 'overdue'],
    ['오늘', (t) => !t.done && t.due === todayStr],
    ['7일 안', (t) => !t.done && t.due > todayStr && t.due <= weekEnd],
    ['나중에', (t) => !t.done && t.due > weekEnd],
    ['마감일 없음', (t) => !t.done && !t.due],
    ['완료', (t) => t.done],
  ].map(([name, test, cls]) => ({ name, cls, items: list.filter(test) })).filter((g) => g.items.length);
}

// ---------- 메일함 ----------
// 숨긴 메일함(이 브라우저에서만 기억하는 보기 설정, 패널과 큰 화면이 공유)
export const hidden = new Set((() => { try { return JSON.parse(localStorage.getItem('hiddenMailboxes') || '[]'); } catch { return []; } })());
const saveHidden = () => { try { localStorage.setItem('hiddenMailboxes', JSON.stringify([...hidden])); } catch { /* 저장 못 해도 동작 */ } };
export const mb = (t) => mailboxOf(t.site, state.settings.mailboxes);
export const shown = (t) => !hidden.has(t.site || '');
export const dot = (m) => h('span', { class: 'mb-dot', style: `background:${m.color}`, 'aria-hidden': 'true' });

export function renderMailboxBar(bar, onChange, { label = true } = {}) {
  const boxes = listMailboxes(state.sites, state.todos, state.settings.mailboxes);
  if (boxes.length < 2) { bar.replaceChildren(); bar.hidden = true; return; }
  bar.hidden = false;
  const count = (key) => state.todos.filter((t) => !t.done && (t.site || '') === key).length;
  bar.replaceChildren(
    ...(label ? [h('span', { class: 'mb-label', text: '메일함' })] : []),
    ...boxes.map((m) => h('button', {
      class: 'mb-toggle',
      'aria-pressed': String(!hidden.has(m.key)),
      title: m.key ? `${m.name} (${m.key}) 보기/숨기기` : `${m.name} 보기/숨기기`,
      onclick: () => { hidden.has(m.key) ? hidden.delete(m.key) : hidden.add(m.key); saveHidden(); onChange(); },
    }, dot(m), h('span', { text: m.name }), h('span', { class: 'mb-count', text: String(count(m.key)) }))),
    ...(hidden.size ? [h('button', { class: 'link', text: '모두 보기', onclick: () => { hidden.clear(); saveHidden(); onChange(); } })] : []),
  );
}

// 다른 화면(패널↔큰 화면)에서 메일함 숨김을 바꾸면 따라감
export function onHiddenChange(fn) {
  window.addEventListener('storage', (e) => {
    if (e.key !== 'hiddenMailboxes') return;
    hidden.clear();
    try { JSON.parse(e.newValue || '[]').forEach((k) => hidden.add(k)); } catch { /* 무시 */ }
    fn();
  });
}

// ---------- 끌어서 날짜 바꾸기 ----------
export function draggable(el, t) {
  el.draggable = true;
  el.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', t.id); e.dataTransfer.effectAllowed = 'move'; el.classList.add('dragging'); });
  el.addEventListener('dragend', () => el.classList.remove('dragging'));
  return el;
}

export function makeDropZone(el, date) {
  el.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; el.classList.add('drag-over'); });
  el.addEventListener('dragleave', (e) => { if (!el.contains(e.relatedTarget)) el.classList.remove('drag-over'); });
  el.addEventListener('drop', (e) => {
    e.preventDefault();
    el.classList.remove('drag-over');
    const id = e.dataTransfer.getData('text/plain');
    const t = state.todos.find((x) => x.id === id);
    if (t && (t.due || '') !== date) update(id, { due: date || null, ...(date ? {} : { dueTime: null }), edited: true });
  });
}

// ---------- 편집 창 ----------
const DIALOG_HTML = `
<form id="editForm" method="dialog">
  <h2 id="editTitle">할 일 수정</h2>
  <label>할 일<input type="text" id="fTitle" required maxlength="200"></label>
  <div class="row">
    <label>마감일<input type="date" id="fDue"></label>
    <label>시간<input type="time" id="fTime"></label>
  </div>
  <div class="row">
    <label>우선순위
      <select id="fPriority">
        <option value="high">높음</option>
        <option value="normal">보통</option>
        <option value="low">낮음</option>
      </select>
    </label>
    <label>메일함<select id="fMailbox"></select></label>
  </div>
  <label>메모<textarea id="fMemo" rows="4" maxlength="5000"></textarea></label>
  <label class="check"><input type="checkbox" id="fDone"> 완료</label>
  <div id="fOrigin" class="origin" hidden>
    <div class="muted">원래 메일 제목</div>
    <div id="fSubject"></div>
    <a id="fLink" target="_blank" rel="noopener" hidden>메일 열기 ↗</a>
  </div>
  <div class="dlg-actions">
    <button type="button" id="fDelete" class="danger">삭제</button>
    <span class="spacer"></span>
    <button type="button" id="fCancel">취소</button>
    <button type="submit" class="primary">저장</button>
  </div>
</form>`;

let editingId = null;
let dlg = null;

function ensureDialog() {
  if (dlg) return dlg;
  dlg = h('dialog', { id: 'editDlg' });
  dlg.innerHTML = DIALOG_HTML; // 고정된 마크업만 넣음(사용자 데이터 없음)
  document.body.append(dlg);
  $('editForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = $('fTitle').value.trim();
    if (!title) return;
    const fields = {
      title,
      due: $('fDue').value || null,
      dueTime: $('fDue').value ? $('fTime').value || null : null,
      priority: $('fPriority').value,
      memo: $('fMemo').value,
      done: $('fDone').checked,
      site: $('fMailbox').value,
    };
    if (editingId) await update(editingId, { ...fields, edited: true, aiDoubt: false });
    else await send({ type: 'todo:add', todo: { ...fields, source: 'manual' } });
    dlg.close();
  });
  $('fCancel').onclick = () => dlg.close();
  $('fDelete').onclick = async () => {
    if (!editingId) return;
    if (!confirm('이 할 일을 삭제할까요?')) return;
    await send({ type: 'todo:delete', id: editingId });
    dlg.close();
  };
  return dlg;
}

export function openEdit(id, date = '') {
  ensureDialog();
  const t = id ? state.todos.find((x) => x.id === id) : null;
  editingId = t ? t.id : null;
  $('editTitle').textContent = t ? '할 일 수정' : '할 일 추가';
  $('fTitle').value = t?.title || '';
  $('fDue').value = t ? t.due || '' : date;
  $('fTime').value = t?.dueTime || '';
  $('fPriority').value = t?.priority || 'normal';
  $('fMemo').value = t?.memo || '';
  $('fDone').checked = !!t?.done;
  const boxes = listMailboxes(state.sites, state.todos, state.settings.mailboxes);
  if (!boxes.some((m) => m.key === '')) boxes.push(mailboxOf(''));
  $('fMailbox').replaceChildren(...boxes.map((m) => h('option', { value: m.key, text: m.key ? `${m.name} (${m.key})` : m.name })));
  // 새로 추가할 때는 지금 하나만 보고 있는 메일함을 기본값으로
  const onlyShown = boxes.filter((m) => !hidden.has(m.key));
  $('fMailbox').value = t ? t.site || '' : onlyShown.length === 1 ? onlyShown[0].key : '';
  $('fDelete').hidden = !t;
  const fromMail = t?.source === 'mail';
  $('fOrigin').hidden = !fromMail;
  if (fromMail) {
    $('fSubject').textContent = `${t.subject}${t.site ? ` (${t.site})` : ''}`;
    $('fLink').hidden = !t.link;
    if (t.link) $('fLink').href = t.link;
  }
  dlg.showModal();
  $('fTitle').focus();
}
