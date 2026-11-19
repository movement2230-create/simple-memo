// 사이드 패널: 위에 현재 탭의 메일함 상태, 그 아래 달력, 맨 아래 목록
import { addDays, sitePattern, ymd } from '../src/rules.js';
import { mailboxOf } from '../src/mailboxes.js';
import {
  $, send, h, state, load, toggleDone, today, isOverdue, sortTodos, formatDue, groupTodos,
  PRIORITY_LABEL, mb, shown, dot, renderMailboxBar, onHiddenChange, draggable, makeDropZone, openEdit,
} from './common.js';

const openPage = (hash = '') => chrome.tabs.create({ url: chrome.runtime.getURL(`pages/dashboard.html${hash}`) });
$('expandBtn').onclick = () => openPage('#calendar');
$('settingsBtn').onclick = () => openPage('#settings');

let view = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let selected = ''; // 달력에서 고른 날짜(없으면 전체)

function render() {
  renderMailboxBar($('mbBar'), render, { label: false });
  renderCalendar();
  renderList();
}

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local') return;
  await load();
  render();
  if (changes.sites || changes.settings) renderSite();
});
onHiddenChange(render);

// ---------- 달력 ----------
const MAX_DOTS = 4;

function renderCalendar() {
  $('monthLabel').textContent = `${view.getFullYear()}년 ${view.getMonth() + 1}월`;
  const showDone = $('showDone').checked;
  const byDate = new Map();
  for (const t of state.todos) {
    if (!t.due || !shown(t) || (t.done && !showDone)) continue;
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
    const items = sortTodos(byDate.get(key) || []);
    const open = items.filter((t) => !t.done);
    const cls = ['mc-day'];
    if (d.getMonth() !== view.getMonth()) cls.push('other');
    if (key === todayStr) cls.push('today');
    if (key === selected) cls.push('selected');
    if (d.getDay() === 0) cls.push('sun');
    if (d.getDay() === 6) cls.push('sat');
    if (open.some(isOverdue)) cls.push('has-overdue');
    // 메일함 색 점: 메일함마다 하나씩(최대 4개)
    const colors = [...new Map(open.map((t) => [t.site || '', mb(t)])).values()];
    const label = `${d.getMonth() + 1}월 ${d.getDate()}일${open.length ? `, 할 일 ${open.length}개` : ''}`;
    const cell = h('button', {
      class: cls.join(' '),
      dataset: { date: key },
      'aria-label': label,
      'aria-pressed': String(key === selected),
      title: open.length ? open.map((t) => `· ${t.title} (${mb(t).name})`).join('\n') : '',
      onclick: () => { selected = selected === key ? '' : key; render(); },
      ondblclick: () => openEdit(null, key),
    },
    h('span', { class: 'n', text: String(d.getDate()) }),
    h('span', { class: 'mc-dots' },
      colors.slice(0, MAX_DOTS).map(dot),
      open.length > MAX_DOTS ? h('span', { class: 'mc-more', text: `+${open.length - MAX_DOTS}` }) : null));
    makeDropZone(cell, key);
    grid.append(cell);
  }
}

$('prevMonth').onclick = () => { view = new Date(view.getFullYear(), view.getMonth() - 1, 1); renderCalendar(); };
$('nextMonth').onclick = () => { view = new Date(view.getFullYear(), view.getMonth() + 1, 1); renderCalendar(); };
$('todayBtn').onclick = () => {
  view = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  selected = today();
  render();
};
$('showDone').onchange = render;
$('clearDay').onclick = () => { selected = ''; render(); };
$('addBtn').onclick = () => openEdit(null, selected || today());

// ---------- 목록 ----------
function item(t) {
  const m = mb(t);
  return draggable(h('div', {
    class: `sp-item p-${t.priority}${t.done ? ' done' : ''}`,
    dataset: { id: t.id },
    title: t.subject && t.subject !== t.title ? `메일: ${t.subject}` : '',
    onclick: () => openEdit(t.id),
  },
  h('button', {
    class: `chk${t.done ? ' on' : ''}`,
    'aria-label': t.done ? '완료 취소' : '완료',
    text: t.done ? '✓' : '',
    onclick: (e) => { e.stopPropagation(); toggleDone(t); },
  }),
  h('div', { class: 'body' },
    h('div', { class: 'title', text: t.title }),
    h('div', { class: 'meta' },
      h('span', { class: 'mb-tag', title: t.site || '' }, dot(m), m.name),
      h('span', { class: `due${isOverdue(t) ? ' overdue' : ''}`, text: formatDue(t, { short: true }) }),
      t.priority !== 'normal' && h('span', { class: `badge p-${t.priority}`, text: PRIORITY_LABEL[t.priority] }),
      t.aiDoubt && !t.done && h('span', { class: 'ai-doubt', title: '내장 AI는 할 일이 아닐 수 있다고 판단했어요', text: 'AI: 할 일 아님?' }),
      t.link && h('a', { href: t.link, target: '_blank', rel: 'noopener', text: '메일 ↗', onclick: (e) => e.stopPropagation() })),
    t.memo && h('div', { class: 'memo', text: t.memo }))), t);
}

function renderList() {
  const showDone = $('showDone').checked;
  const q = $('listSearch').value.trim().toLowerCase();
  let list = state.todos.filter((t) => shown(t) && (showDone || !t.done));
  if (selected) list = list.filter((t) => t.due === selected);
  if (q) list = list.filter((t) => [t.title, t.memo, t.subject].some((s) => (s || '').toLowerCase().includes(q)));
  list = sortTodos(list);

  if (selected) {
    const d = new Date(`${selected}T00:00`);
    $('listTitle').textContent = `${d.getMonth() + 1}월 ${d.getDate()}일 (${'일월화수목금토'[d.getDay()]}) 할 일`;
  } else {
    $('listTitle').textContent = '할 일';
  }
  $('clearDay').hidden = !selected;

  const body = $('listBody');
  body.replaceChildren();
  if (!list.length) {
    body.append(h('p', { class: 'empty', text: q ? '검색 결과가 없어요.' : selected ? '이 날은 할 일이 없어요. 위의 "+ 추가"로 넣을 수 있어요.' : '할 일이 없어요. 메일함을 연 상태에서 위의 "이 메일함에서 켜기"를 눌러 보세요.' }));
    return;
  }
  if (selected) {
    body.append(...list.map(item));
    return;
  }
  for (const { name, cls, items } of groupTodos(list)) {
    body.append(h('h3', { class: `group-title${cls ? ' ' + cls : ''}`, text: `${name} (${items.length})` }));
    body.append(...items.map(item));
  }
}
$('listSearch').oninput = renderList;

// ---------- 지금 보고 있는 탭의 메일함 ----------
let tab = null;
let host = '';
const say = (text) => { $('msg').textContent = text; };

async function renderSite() {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let url = null;
  try { url = new URL(tab?.url || ''); } catch { /* 주소 없음 */ }
  const isWeb = url && /^https?:$/.test(url.protocol);
  const newHost = isWeb ? url.hostname : '';
  if (newHost !== host) say('');
  host = newHost;

  if (!isWeb) {
    $('siteName').textContent = '메일함 탭이 아니에요';
    $('siteState').hidden = true;
    $('siteDot').hidden = true;
    $('siteHelp').textContent = '메일함(사내 메일, Gmail, 네이버 메일 등) 탭으로 가면 여기서 켜고 끌 수 있어요.';
    for (const id of ['toggleSite', 'scanBtn', 'pickBtn']) $(id).hidden = true;
    $('mbNameRow').hidden = true;
    return;
  }
  const { sites = [], settings = {} } = await chrome.storage.local.get(['sites', 'settings']);
  const granted = await chrome.permissions.contains({ origins: [sitePattern(host)] });
  const on = granted && sites.includes(host);
  const m = mailboxOf(host, settings.mailboxes);

  $('siteName').textContent = on ? m.name : host;
  $('siteName').title = host;
  $('siteDot').hidden = !on;
  $('siteDot').style.background = m.color;
  $('siteState').hidden = false;
  $('siteState').textContent = on ? '수집 중' : '꺼짐';
  $('siteState').classList.toggle('on', on);
  $('siteHelp').textContent = on
    ? `${host} · 목록에 보이는 메일 제목을 자동으로 읽어요.`
    : '켜면 이 사이트의 메일 목록에서 제목만 읽어 할 일을 만들어요. 브라우저가 이 사이트 접근 권한을 물어봐요.';
  $('toggleSite').hidden = false;
  $('toggleSite').textContent = on ? '끄기' : '이 메일함에서 켜기';
  $('toggleSite').className = on ? '' : 'primary';
  $('toggleSite').onclick = on ? disable : enable;
  $('scanBtn').hidden = !on;
  $('pickBtn').hidden = !on;
  $('mbNameRow').hidden = !on;
  if (document.activeElement !== $('mbName')) $('mbName').value = m.name;
}

$('mbName').onchange = async () => {
  const name = $('mbName').value.trim();
  const { settings = {} } = await chrome.storage.local.get('settings');
  const mailboxes = { ...(settings.mailboxes || {}) };
  const { key, ...base } = mailboxOf(host, mailboxes);
  if (!name) { $('mbName').value = base.name; return; }
  mailboxes[host] = { ...base, name };
  await send({ type: 'settings:set', patch: { mailboxes } });
  say(`메일함 이름을 "${name}"(으)로 바꿨어요.`);
};

async function enable() {
  // 권한 요청은 클릭 직후에 바로 해야 합니다.
  const ok = await chrome.permissions.request({ origins: [sitePattern(host)] });
  if (!ok) { say('권한을 허용하지 않아서 켜지 못했어요.'); return; }
  await send({ type: 'site:enable', host, tabId: tab.id });
  say('켰어요. 메일 목록을 읽는 중…');
  await renderSite();
  setTimeout(scan, 1200);
}

async function disable() {
  await send({ type: 'site:disable', host });
  await chrome.permissions.remove({ origins: [sitePattern(host)] }).catch(() => {});
  say('껐어요. 이미 만든 할 일은 그대로 남아 있어요.');
  await renderSite();
}

async function scan() {
  try {
    const r = await chrome.tabs.sendMessage(tab.id, { type: 'scan' });
    if (!r || !r.found) say('메일 제목을 찾지 못했어요. "목록 직접 지정"을 누르고 메일 제목 하나를 클릭해 주세요.');
    else say(`제목 ${r.found}개를 읽었어요. 새 할 일 ${r.added}개`);
  } catch {
    say('페이지와 연결하지 못했어요. 메일함 페이지를 새로 고친 뒤 다시 눌러 주세요.');
  }
}
$('scanBtn').onclick = scan;
$('pickBtn').onclick = async () => {
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'pick' });
    say('메일함 화면에서 메일 제목 하나를 클릭해 주세요. (Esc: 취소)');
  } catch {
    say('페이지와 연결하지 못했어요. 메일함 페이지를 새로 고친 뒤 다시 눌러 주세요.');
  }
};

// 탭을 옮기거나 페이지가 바뀌면 위쪽 메일함 정보를 다시 그림
chrome.tabs.onActivated.addListener(renderSite);
chrome.tabs.onUpdated.addListener((id, info) => { if (id === tab?.id && (info.url || info.status === 'complete')) renderSite(); });
chrome.windows.onFocusChanged.addListener(renderSite);

// ---------- 시작 ----------
await load();
render();
renderSite();
// 자정을 넘기면 "오늘" 표시를 새로 고침(날짜가 바뀔 때만)
let lastDay = today();
setInterval(() => { if (today() !== lastDay) { lastDay = today(); render(); } }, 60 * 1000);
