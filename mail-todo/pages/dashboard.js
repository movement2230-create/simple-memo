// 큰 화면: 달력·목록·설정 (사이드 패널의 "크게 보기")
import { DEFAULT_RULES, addDays, mergeRules, sitePattern, ymd } from '../src/rules.js';
import { aiAvailability, prepareModel, refineSubject } from '../src/ai.js';
import { mailboxOf } from '../src/mailboxes.js';
import {
  $, send, h, state, load as loadState, update, toggleDone, today, isOverdue, sortTodos, formatDue, groupTodos,
  PRIORITY_LABEL, mb, shown, dot, renderMailboxBar, onHiddenChange, draggable, makeDropZone, openEdit,
} from './common.js';

let todos = [];
let settings = {};
let sites = [];
let view = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

async function load() {
  await loadState();
  ({ todos, settings, sites } = state);
}

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local') return;
  await load();
  render();
  if (changes.todos) scheduleAI();
});
onHiddenChange(() => render());

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
  if (tab !== 'settings') renderMailboxBar($('mbBar'), render);
  if (tab === 'calendar') renderCalendar();
  else if (tab === 'list') renderList();
  else renderSettings();
}

// ---------- 할 일 조각(달력·사이드 공용) ----------
function chip(t) {
  return draggable(h('div', {
    class: `chip p-${t.priority}${t.done ? ' done' : ''}${isOverdue(t) ? ' overdue' : ''}`,
    title: [t.title, `메일함: ${mb(t).name}`, t.dueTime && `시간: ${t.dueTime}`, t.memo && `메모: ${t.memo}`, t.subject && t.subject !== t.title && `메일: ${t.subject}`].filter(Boolean).join('\n'),
    dataset: { id: t.id },
    onclick: () => openEdit(t.id),
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
  t.aiDoubt && !t.done && h('span', { class: 'ai-doubt', title: '내장 AI는 할 일이 아닐 수 있다고 판단했어요', text: 'AI?' })), t);
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

  const body = $('listBody');
  body.replaceChildren();
  if (!list.length) {
    body.append(h('p', { class: 'empty', text: q ? '검색 결과가 없어요.' : '할 일이 없어요. 메일함 페이지에서 확장 프로그램을 켜 보세요.' }));
    return;
  }
  for (const { name, cls, items } of groupTodos(list)) {
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
