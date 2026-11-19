// 달력·목록·설정 화면
import { DEFAULT_RULES, addDays, mergeRules, parseYmd, sitePattern, ymd } from '../src/rules.js';
import { aiAvailability, prepareModel, refineSubject } from '../src/ai.js';
import { listMailboxes, mailboxOf } from '../src/mailboxes.js';

const $ = (id) => document.getElementById(id);
const send = (msg) => chrome.runtime.sendMessage(msg);
const PRIORITY_LABEL = { high: '높음', normal: '보통', low: '낮음' };
const PRIORITY_ORDER = { high: 0, normal: 1, low: 2 };

let todos = [];
let settings = {};
let sites = [];
let view = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

// 숨긴 메일함(이 브라우저에서만 기억하는 보기 설정)
const hidden = new Set((() => { try { return JSON.parse(localStorage.getItem('hiddenMailboxes') || '[]'); } catch { return []; } })());
const saveHidden = () => { try { localStorage.setItem('hiddenMailboxes', JSON.stringify([...hidden])); } catch { /* 저장 못 해도 동작 */ } };
const mb = (t) => mailboxOf(t.site, settings.mailboxes);
const shown = (t) => !hidden.has(t.site || '');
const dot = (m) => h('span', { class: 'mb-dot', style: `background:${m.color}`, 'aria-hidden': 'true' });

// 사용자 데이터(메일 제목 등)는 항상 textContent로만 넣습니다.
function h(tag, props = {}, ...children) {
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

const today = () => ymd(new Date());
const isOverdue = (t) => !t.done && t.due && t.due < today();

function sortTodos(list) {
  return [...list].sort((a, b) =>
    (a.done - b.done)
    || (a.due || '9999').localeCompare(b.due || '9999')
    || (a.dueTime || '99').localeCompare(b.dueTime || '99')
    || PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]
    || a.createdAt.localeCompare(b.createdAt));
}

function formatDue(t) {
  if (!t.due) return '마감일 없음';
  const d = parseYmd(t.due);
  const diff = Math.round((d - parseYmd(today())) / 86400000);
  const rel = diff === 0 ? '오늘' : diff === 1 ? '내일' : diff === -1 ? '어제' : diff < 0 ? `${-diff}일 지남` : `${diff}일 남음`;
  const wd = '일월화수목금토'[d.getDay()];
  return `${d.getMonth() + 1}/${d.getDate()}(${wd})${t.dueTime ? ' ' + t.dueTime : ''} · ${rel}`;
}

// ---------- 데이터 ----------
async function load() {
  const d = await chrome.storage.local.get(['todos', 'settings', 'sites']);
  todos = d.todos || [];
  settings = d.settings || {};
  sites = d.sites || [];
}

const update = (id, patch) => send({ type: 'todo:update', id, patch });
const toggleDone = (t) => update(t.id, { done: !t.done });

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local') return;
  await load();
  render();
  if (changes.todos) scheduleAI();
});

// ---------- 탭 ----------
function showTab(name) {
  document.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
  document.querySelectorAll('.tab').forEach((s) => { s.hidden = s.id !== `tab-${name}`; });
  history.replaceState(null, '', `#${name}`);
  render();
}
document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
const currentTab = () => document.querySelector('.tabs button[aria-selected="true"]').dataset.tab;

function render() {
  const tab = currentTab();
  $('mbBar').hidden = tab === 'settings';
  if (tab !== 'settings') renderMailboxBar();
  if (tab === 'calendar') renderCalendar();
  else if (tab === 'list') renderList();
  else renderSettings();
}

// ---------- 메일함 골라 보기 ----------
function renderMailboxBar() {
  const boxes = listMailboxes(sites, todos, settings.mailboxes);
  const bar = $('mbBar');
  if (boxes.length < 2) { bar.replaceChildren(); bar.hidden = true; return; }
  const count = (key) => todos.filter((t) => !t.done && (t.site || '') === key).length;
  bar.replaceChildren(
    h('span', { class: 'mb-label', text: '메일함' }),
    ...boxes.map((m) => h('button', {
      class: 'mb-toggle',
      'aria-pressed': String(!hidden.has(m.key)),
      title: m.key ? `${m.name} (${m.key})` : m.name,
      onclick: () => { hidden.has(m.key) ? hidden.delete(m.key) : hidden.add(m.key); saveHidden(); render(); },
    }, dot(m), h('span', { text: m.name }), h('span', { class: 'mb-count', text: String(count(m.key)) }))),
    ...(hidden.size ? [h('button', { class: 'link', text: '모두 보기', onclick: () => { hidden.clear(); saveHidden(); render(); } })] : []),
  );
}

// ---------- 할 일 조각(달력·사이드 공용) ----------
function chip(t) {
  const el = h('div', {
    class: `chip p-${t.priority}${t.done ? ' done' : ''}${isOverdue(t) ? ' overdue' : ''}`,
    draggable: 'true',
    title: [t.title, `메일함: ${mb(t).name}`, t.dueTime && `시간: ${t.dueTime}`, t.memo && `메모: ${t.memo}`, t.subject && t.subject !== t.title && `메일: ${t.subject}`].filter(Boolean).join('\n'),
    dataset: { id: t.id },
    onclick: () => openEdit(t.id),
    ondragstart: (e) => { e.dataTransfer.setData('text/plain', t.id); e.dataTransfer.effectAllowed = 'move'; el.classList.add('dragging'); },
    ondragend: () => el.classList.remove('dragging'),
  },
  h('button', {
    class: `chk${t.done ? ' on' : ''}`,
    'aria-label': t.done ? '완료 취소' : '완료',
    text: t.done ? '✓' : '',
    onclick: (e) => { e.stopPropagation(); toggleDone(t); },
  }),
  dot(mb(t)),
  t.dueTime && h('span', { class: 'time', text: t.dueTime }),
  h('span', { class: 't', text: t.title }),
  t.aiDoubt && !t.done && h('span', { class: 'ai-doubt', title: '내장 AI는 할 일이 아닐 수 있다고 판단했어요', text: 'AI?' }));
  return el;
}

function makeDropZone(el, date) {
  el.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; el.classList.add('drag-over'); });
  el.addEventListener('dragleave', (e) => { if (!el.contains(e.relatedTarget)) el.classList.remove('drag-over'); });
  el.addEventListener('drop', (e) => {
    e.preventDefault();
    el.classList.remove('drag-over');
    const id = e.dataTransfer.getData('text/plain');
    const t = todos.find((x) => x.id === id);
    if (t && (t.due || '') !== date) update(id, { due: date || null, ...(date ? {} : { dueTime: null }), edited: true });
  });
}

// ---------- 달력 ----------
function renderCalendar() {
  const showDone = $('showDone').checked;
  $('monthLabel').textContent = `${view.getFullYear()}년 ${view.getMonth() + 1}월`;

  const byDate = new Map();
  for (const t of todos) {
    if (!t.due || (!showDone && t.done) || !shown(t)) continue;
    if (!byDate.has(t.due)) byDate.set(t.due, []);
    byDate.get(t.due).push(t);
  }

  const first = new Date(view.getFullYear(), view.getMonth(), 1);
  const daysInMonth = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
  const start = addDays(first, -first.getDay());
  const cells = Math.ceil((first.getDay() + daysInMonth) / 7) * 7;
  const todayStr = today();
  const grid = $('calGrid');
  grid.replaceChildren();

  for (let i = 0; i < cells; i++) {
    const d = addDays(start, i);
    const key = ymd(d);
    const list = sortTodos(byDate.get(key) || []);
    const cls = ['day'];
    if (d.getMonth() !== view.getMonth()) cls.push('other');
    if (key === todayStr) cls.push('today');
    if (d.getDay() === 0) cls.push('sun');
    if (d.getDay() === 6) cls.push('sat');
    const cell = h('div', { class: cls.join(' '), dataset: { date: key } },
      h('div', { class: 'head' },
        h('span', { class: 'num', text: String(d.getDate()) }),
        h('button', { class: 'add', title: '이 날에 할 일 추가', 'aria-label': `${d.getMonth() + 1}월 ${d.getDate()}일에 할 일 추가`, text: '+', onclick: () => openEdit(null, key) })),
      h('div', { class: 'items' }, list.map(chip)));
    cell.addEventListener('dblclick', (e) => { if (e.target === cell || e.target.classList.contains('items')) openEdit(null, key); });
    makeDropZone(cell, key);
    grid.append(cell);
  }

  const noDue = sortTodos(todos.filter((t) => !t.due && (showDone || !t.done) && shown(t)));
  $('noDueCount').textContent = noDue.length ? `${noDue.length}` : '';
  $('noDueList').replaceChildren(...(noDue.length ? noDue.map((t) => h('li', {}, chip(t))) : [h('li', { class: 'empty', text: '없음' })]));
}

$('prevMonth').onclick = () => { view = new Date(view.getFullYear(), view.getMonth() - 1, 1); renderCalendar(); };
$('nextMonth').onclick = () => { view = new Date(view.getFullYear(), view.getMonth() + 1, 1); renderCalendar(); };
$('todayBtn').onclick = () => { view = new Date(new Date().getFullYear(), new Date().getMonth(), 1); renderCalendar(); };
$('showDone').onchange = renderCalendar;
makeDropZone($('noDueList'), '');

// ---------- 목록 ----------
function renderList() {
  const filter = $('listFilter').value;
  const q = $('listSearch').value.trim().toLowerCase();
  let list = todos.filter((t) => shown(t) && (filter === 'all' ? true : filter === 'done' ? t.done : !t.done));
  if (q) list = list.filter((t) => [t.title, t.memo, t.subject].some((s) => (s || '').toLowerCase().includes(q)));
  list = sortTodos(list);
  $('listCount').textContent = `${list.length}개`;

  const todayStr = today();
  const weekEnd = ymd(addDays(new Date(), 7));
  const groups = [
    ['지난 마감', (t) => !t.done && t.due && t.due < todayStr, 'overdue'],
    ['오늘', (t) => !t.done && t.due === todayStr],
    ['7일 안', (t) => !t.done && t.due > todayStr && t.due <= weekEnd],
    ['나중에', (t) => !t.done && t.due > weekEnd],
    ['마감일 없음', (t) => !t.done && !t.due],
    ['완료', (t) => t.done],
  ];
  const body = $('listBody');
  body.replaceChildren();
  if (!list.length) {
    body.append(h('p', { class: 'empty', text: q ? '검색 결과가 없어요.' : '할 일이 없어요. 메일함 페이지에서 확장 프로그램을 켜 보세요.' }));
    return;
  }
  for (const [name, test, cls] of groups) {
    const items = list.filter(test);
    if (!items.length) continue;
    body.append(h('h3', { class: `group-title${cls ? ' ' + cls : ''}`, text: `${name} (${items.length})` }));
    for (const t of items) body.append(row(t));
  }
}

function row(t) {
  return h('div', { class: `todo-row${t.done ? ' done' : ''}` },
    h('button', { class: `chk${t.done ? ' on' : ''}`, 'aria-label': t.done ? '완료 취소' : '완료', text: t.done ? '✓' : '', onclick: () => toggleDone(t) }),
    h('div', { class: 'main', onclick: () => openEdit(t.id) },
      h('div', { class: 'title', text: t.title }),
      (t.memo || (t.subject && t.subject !== t.title)) && h('div', { class: 'sub', text: t.memo || `메일: ${t.subject}` })),
    t.aiDoubt && !t.done && h('span', { class: 'ai-doubt', title: '내장 AI는 할 일이 아닐 수 있다고 판단했어요', text: 'AI: 할 일 아님?' }),
    h('span', { class: 'mb-tag', title: t.site || '' }, dot(mb(t)), mb(t).name),
    h('span', { class: `badge p-${t.priority}`, text: PRIORITY_LABEL[t.priority] }),
    h('span', { class: `due${isOverdue(t) ? ' overdue' : ''}`, text: formatDue(t) }),
    t.link && h('a', { href: t.link, target: '_blank', rel: 'noopener', text: '메일 ↗' }),
    h('button', { class: 'link', text: '수정', onclick: () => openEdit(t.id) }));
}

$('listFilter').onchange = renderList;
$('listSearch').oninput = renderList;

// ---------- 편집 창 ----------
let editingId = null;
const dlg = $('editDlg');

function openEdit(id, date = '') {
  const t = id ? todos.find((x) => x.id === id) : null;
  editingId = t ? t.id : null;
  $('editTitle').textContent = t ? '할 일 수정' : '할 일 추가';
  $('fTitle').value = t?.title || '';
  $('fDue').value = t ? t.due || '' : date;
  $('fTime').value = t?.dueTime || '';
  $('fPriority').value = t?.priority || 'normal';
  $('fMemo').value = t?.memo || '';
  $('fDone').checked = !!t?.done;
  const boxes = listMailboxes(sites, todos, settings.mailboxes);
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
$('addBtn').onclick = () => openEdit(null, currentTab() === 'calendar' ? today() : '');

// ---------- 설정 ----------
function renderSettings() {
  const saveMailbox = (host, patch) => send({
    type: 'settings:set',
    patch: { mailboxes: { ...(settings.mailboxes || {}), [host]: { ...mailboxOf(host, settings.mailboxes), ...patch, key: undefined } } },
  });
  // 이름을 고치는 중이면 다시 그리지 않음(입력이 끊기지 않게)
  if (!document.activeElement?.closest('#siteList')) $('siteList').replaceChildren(...(sites.length
    ? sites.map((host) => h('li', {},
      h('input', { type: 'color', value: mailboxOf(host, settings.mailboxes).color, 'aria-label': `${host} 색`, onchange: (e) => saveMailbox(host, { color: e.target.value }) }),
      h('input', {
        type: 'text',
        class: 'mb-name',
        value: mailboxOf(host, settings.mailboxes).name,
        maxlength: '20',
        'aria-label': `${host} 이름`,
        onchange: (e) => { const name = e.target.value.trim(); if (name) saveMailbox(host, { name }); },
      }),
      h('span', { class: 'muted host', text: host }),
      h('button', {
        class: 'danger',
        text: '끄기',
        onclick: async () => {
          await send({ type: 'site:disable', host });
          await chrome.permissions.remove({ origins: [sitePattern(host)] }).catch(() => {});
        },
      })))
    : [h('li', { class: 'muted', text: '아직 켠 메일함이 없어요.' })]));

  // 입력 중에는 덮어쓰지 않음
  if (!document.activeElement?.closest('.rules')) {
    const rules = mergeRules(settings.rules);
    $('ruleTask').value = rules.taskKeywords.join('\n');
    $('ruleExclude').value = rules.excludeKeywords.join('\n');
    $('ruleUrgent').value = rules.urgentKeywords.join('\n');
  }
  $('useAI').checked = !!settings.useAI;
  refreshAIState();
}

const lines = (id) => [...new Set($(id).value.split('\n').map((s) => s.trim()).filter(Boolean))];
$('saveRules').onclick = async () => {
  await send({ type: 'settings:set', patch: { rules: { taskKeywords: lines('ruleTask'), excludeKeywords: lines('ruleExclude'), urgentKeywords: lines('ruleUrgent') } } });
  flash('rulesMsg', '저장했어요. 새로 읽는 메일부터 적용돼요.');
};
$('resetRules').onclick = async () => {
  if (!confirm('규칙을 기본값으로 되돌릴까요?')) return;
  $('ruleTask').blur();
  await send({ type: 'settings:set', patch: { rules: { ...DEFAULT_RULES } } });
  flash('rulesMsg', '기본값으로 되돌렸어요.');
};

function flash(id, text) {
  $(id).textContent = text;
  clearTimeout(flash[id]);
  flash[id] = setTimeout(() => { $(id).textContent = ''; }, 4000);
}

$('exportBtn').onclick = () => {
  const blob = new Blob([JSON.stringify({ app: 'mail-todo', version: 1, exportedAt: new Date().toISOString(), todos, settings }, null, 2)], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: `mail-todo-backup-${today()}.json` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
$('importFile').onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.todos)) throw new Error('할 일 목록이 없는 파일');
    const valid = data.todos.filter((t) => t && typeof t.id === 'string' && typeof t.title === 'string');
    if (!confirm(`백업의 할 일 ${valid.length}개로 지금 목록(${todos.length}개)을 바꿀까요?`)) return;
    await send({ type: 'todos:replace', todos: valid });
    if (data.settings?.rules) await send({ type: 'settings:set', patch: { rules: data.settings.rules } });
    flash('dataMsg', `${valid.length}개를 가져왔어요.`);
  } catch (err) {
    flash('dataMsg', `가져오지 못했어요: ${err.message}`);
  }
};
$('clearSeen').onclick = async () => {
  if (!confirm('처리 기록을 지우면 메일함을 다시 읽을 때 모든 메일을 처음부터 판단해요. 지웠던 할 일이 다시 생길 수 있어요. 계속할까요?')) return;
  await send({ type: 'seen:clear' });
  flash('dataMsg', '처리 기록을 지웠어요. 메일함 페이지를 새로 고치면 다시 읽어요.');
};
$('clearAll').onclick = async () => {
  if (!confirm(`할 일 ${todos.length}개를 모두 삭제할까요? 되돌릴 수 없어요.`)) return;
  await send({ type: 'todos:replace', todos: [] });
  flash('dataMsg', '모두 삭제했어요.');
};

// ---------- 내장 AI ----------
const AI_TEXT = {
  unsupported: '이 브라우저에는 내장 AI가 없어요. 규칙만으로 동작해요.',
  unavailable: '이 PC에서는 내장 AI를 쓸 수 없어요(사양 부족 또는 관리자 설정). 규칙만으로 동작해요.',
  downloadable: 'AI 모델을 아직 내려받지 않았어요. 아래 버튼을 누르면 준비해요(브라우저 제조사 서버에서 모델만 내려받고, 메일 제목은 보내지 않아요).',
  downloading: 'AI 모델을 내려받는 중이에요…',
  available: '사용할 수 있어요.',
};

async function refreshAIState() {
  const st = await aiAvailability();
  $('aiState').textContent = AI_TEXT[st] || st;
  $('aiPrepare').hidden = !(st === 'downloadable' || st === 'downloading');
  $('aiRunNow').hidden = !(st === 'available' && settings.useAI);
  return st;
}

$('useAI').onchange = async () => {
  await send({ type: 'settings:set', patch: { useAI: $('useAI').checked } });
  scheduleAI();
};
$('aiPrepare').onclick = async () => {
  $('aiPrepare').disabled = true;
  try {
    await prepareModel((p) => { $('aiState').textContent = `AI 모델 내려받는 중… ${Math.round(p * 100)}%`; });
    await refreshAIState();
    scheduleAI();
  } catch (e) {
    $('aiState').textContent = `준비하지 못했어요: ${e.message}`;
  } finally {
    $('aiPrepare').disabled = false;
  }
};
$('aiRunNow').onclick = () => runAI();

let aiTimer = null;
let aiRunning = false;
function scheduleAI() {
  clearTimeout(aiTimer);
  aiTimer = setTimeout(runAI, 1000);
}

async function runAI() {
  if (aiRunning || !settings.useAI) return;
  const targets = todos.filter((t) => t.source === 'mail' && !t.aiChecked && !t.edited && !t.done);
  if (!targets.length) return;
  if ((await aiAvailability()) !== 'available') return;
  aiRunning = true;
  const status = $('aiStatus');
  status.hidden = false;
  try {
    let n = 0;
    for (const t of targets) {
      status.textContent = `내장 AI로 다듬는 중… ${++n}/${targets.length}`;
      const patch = { aiChecked: true };
      try {
        const r = await refineSubject(t.subject || t.title, today());
        const latest = (await chrome.storage.local.get('todos')).todos?.find((x) => x.id === t.id);
        if (!latest || latest.edited) continue; // 그 사이 사용자가 고쳤으면 건드리지 않음
        if (r.title) patch.title = r.title;
        if (!latest.due && r.due) patch.due = r.due;
        if (r.priority === 'high') patch.priority = 'high';
        if (!r.isTask) patch.aiDoubt = true;
      } catch (e) {
        console.warn('AI 다듬기 실패', e);
      }
      await update(t.id, patch);
    }
  } finally {
    aiRunning = false;
    status.textContent = '내장 AI 다듬기 완료';
    setTimeout(() => { status.hidden = true; }, 3000);
  }
}

// ---------- 시작 ----------
await load();
const initial = location.hash.slice(1);
showTab(['calendar', 'list', 'settings'].includes(initial) ? initial : 'calendar');
scheduleAI();
