import { sitePattern, ymd } from '../src/rules.js';

const $ = (id) => document.getElementById(id);
const send = (msg) => chrome.runtime.sendMessage(msg);
const openDashboard = (hash = '') => chrome.tabs.create({ url: chrome.runtime.getURL(`pages/dashboard.html${hash}`) });

$('openDash').onclick = () => { openDashboard(); window.close(); };

let tab = null;
let host = '';

function say(text) { $('msg').textContent = text; }

async function renderSite() {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let url = null;
  try { url = new URL(tab?.url || ''); } catch { /* 주소 없음 */ }
  if (!url || !/^https?:$/.test(url.protocol)) {
    $('siteName').textContent = '메일함 페이지가 아니에요';
    $('siteState').hidden = true;
    $('siteHelp').textContent = '사내 메일, Gmail, Outlook 같은 메일함을 연 상태에서 아이콘을 눌러 주세요.';
    $('toggleSite').hidden = true;
    return;
  }
  host = url.hostname;
  const { sites = [] } = await chrome.storage.local.get('sites');
  const granted = await chrome.permissions.contains({ origins: [sitePattern(host)] });
  const on = granted && sites.includes(host);

  $('siteName').textContent = host;
  $('siteState').textContent = on ? '수집 중' : '꺼짐';
  $('siteState').classList.toggle('on', on);
  $('siteHelp').textContent = on
    ? '목록에 보이는 메일 제목을 자동으로 읽어요. 제목을 못 찾으면 "목록 직접 지정"을 눌러 제목 하나를 클릭해 주세요.'
    : '켜면 이 사이트의 메일 목록에서 제목만 읽어 할 일을 만들어요. 브라우저가 이 사이트 접근 권한을 물어봐요.';
  $('toggleSite').textContent = on ? '이 메일함에서 끄기' : '이 메일함에서 켜기';
  $('toggleSite').className = on ? '' : 'primary';
  $('toggleSite').onclick = on ? disable : enable;
  $('scanBtn').hidden = !on;
  $('pickBtn').hidden = !on;
}

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
    if (!r || !r.found) say('메일 제목을 찾지 못했어요. "목록 직접 지정"을 눌러 메일 제목 하나를 클릭해 주세요.');
    else say(`제목 ${r.found}개를 읽었어요. 새 할 일 ${r.added}개`);
  } catch {
    say('페이지와 연결하지 못했어요. 메일함 페이지를 새로 고친 뒤 다시 눌러 주세요.');
  }
}

$('scanBtn').onclick = scan;
$('pickBtn').onclick = async () => {
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'pick' });
    window.close(); // 팝업을 닫아야 페이지를 클릭할 수 있음
  } catch {
    say('페이지와 연결하지 못했어요. 메일함 페이지를 새로 고친 뒤 다시 눌러 주세요.');
  }
};

async function renderDue() {
  const { todos = [] } = await chrome.storage.local.get('todos');
  const today = ymd(new Date());
  const due = todos
    .filter((t) => !t.done && t.due && t.due <= today)
    .sort((a, b) => a.due.localeCompare(b.due) || (a.dueTime || '99').localeCompare(b.dueTime || '99'));
  $('dueCount').textContent = due.length ? `${due.length}` : '';
  const list = $('dueList');
  list.replaceChildren();
  if (!due.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = '오늘까지 할 일이 없어요.';
    list.append(li);
    return;
  }
  for (const t of due) {
    const li = document.createElement('li');
    const chk = document.createElement('button');
    chk.className = 'chk';
    chk.setAttribute('aria-label', '완료');
    chk.title = '완료';
    chk.onclick = () => send({ type: 'todo:update', id: t.id, patch: { done: true } });
    const title = document.createElement('span');
    title.className = 't';
    title.textContent = t.title;
    title.title = t.title;
    title.onclick = () => { openDashboard('#list'); window.close(); };
    const d = document.createElement('span');
    d.className = `d${t.due < today ? ' overdue' : ''}`;
    d.textContent = t.due < today ? `${t.due.slice(5).replace('-', '/')} 지남` : (t.dueTime || '오늘');
    li.append(chk, title, d);
    list.append(li);
  }
}

chrome.storage.onChanged.addListener((c, area) => { if (area === 'local' && c.todos) renderDue(); });
renderSite();
renderDue();
