// 백그라운드 서비스 워커
// - 메일 페이지(content.js)가 보낸 제목을 규칙으로 분석해 할 일로 저장
// - 할 일 추가·수정·삭제를 한 줄로 세워 처리(동시에 저장하다 덮어쓰는 일 방지)
// - 사용자가 켠 메일 사이트에만 content.js를 등록
// 네트워크 요청은 하지 않습니다.
import { analyzeSubject, mergeRules, sitePattern, subjectKey, ymd } from './rules.js';

const SEEN_LIMIT = 5000;

// ---------- 직렬 처리 ----------
let queue = Promise.resolve();
function serial(fn) {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

const get = (keys) => chrome.storage.local.get(keys);
const set = (obj) => chrome.storage.local.set(obj);

function newTodo(fields) {
  return {
    id: crypto.randomUUID(),
    title: '',
    subject: '',
    due: null,
    dueTime: null,
    priority: 'normal',
    done: false,
    memo: '',
    source: 'manual',
    site: '',
    link: '',
    createdAt: new Date().toISOString(),
    edited: false,
    aiChecked: false,
    ...fields,
  };
}

// ---------- 메일 제목 → 할 일 ----------
async function processSubjects(site, items) {
  const { todos = [], seen = {}, settings = {} } = await get(['todos', 'seen', 'settings']);
  const rules = mergeRules(settings.rules);
  const now = new Date();
  let added = 0;

  for (const it of items || []) {
    const subject = String(it?.subject || '').replace(/\s+/g, ' ').trim().slice(0, 300);
    if (!subject) continue;
    const key = subjectKey(site, subject);
    if (seen[key]) continue; // 이미 본 메일(삭제한 할 일도 다시 만들지 않음)
    seen[key] = now.getTime();

    const r = analyzeSubject(subject, now, rules);
    if (!r.isTask) continue;
    todos.push(newTodo({
      title: r.title,
      subject,
      due: r.due,
      dueTime: r.dueTime,
      priority: r.priority,
      source: 'mail',
      site,
      link: typeof it.link === 'string' ? it.link.slice(0, 2000) : '',
    }));
    added++;
  }

  const keys = Object.keys(seen);
  if (keys.length > SEEN_LIMIT) {
    keys.sort((a, b) => seen[a] - seen[b]);
    for (const k of keys.slice(0, keys.length - SEEN_LIMIT)) delete seen[k];
  }
  await set({ todos, seen });
  return { added };
}

// ---------- 할 일 수정 ----------
async function mutateTodos(fn) {
  const { todos = [] } = await get('todos');
  const result = fn(todos);
  await set({ todos: result.todos });
  return result.reply ?? { ok: true };
}

// ---------- 사이트 켜기/끄기 ----------
const scriptId = (host) => `site-${host.replace(/[^a-z0-9]/gi, '_')}`;

async function enableSite(host, tabId) {
  const id = scriptId(host);
  try { await chrome.scripting.unregisterContentScripts({ ids: [id] }); } catch { /* 처음 켜는 경우 */ }
  await chrome.scripting.registerContentScripts([{
    id,
    matches: [sitePattern(host)],
    js: ['src/content.js'],
    runAt: 'document_idle',
    allFrames: true,
  }]);
  const { sites = [] } = await get('sites');
  if (!sites.includes(host)) await set({ sites: [...sites, host] });
  if (tabId) {
    await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ['src/content.js'] }).catch(() => {});
  }
  return { ok: true };
}

async function disableSite(host) {
  try { await chrome.scripting.unregisterContentScripts({ ids: [scriptId(host)] }); } catch { /* 이미 꺼짐 */ }
  const { sites = [] } = await get('sites');
  await set({ sites: sites.filter((s) => s !== host) });
  return { ok: true };
}

// ---------- 메시지 ----------
const handlers = {
  subjects: (m) => processSubjects(String(m.site || ''), m.items),
  'todo:add': (m) => mutateTodos((todos) => {
    const t = newTodo({ ...m.todo, id: undefined });
    t.id = crypto.randomUUID();
    return { todos: [...todos, t], reply: { ok: true, id: t.id } };
  }),
  'todo:update': (m) => mutateTodos((todos) => ({
    todos: todos.map((t) => (t.id === m.id ? { ...t, ...m.patch, id: t.id } : t)),
  })),
  'todo:delete': (m) => mutateTodos((todos) => ({ todos: todos.filter((t) => t.id !== m.id) })),
  'todos:replace': (m) => mutateTodos(() => ({ todos: Array.isArray(m.todos) ? m.todos : [] })),
  'seen:clear': () => set({ seen: {} }).then(() => ({ ok: true })),
  'settings:set': async (m) => {
    const { settings = {} } = await get('settings');
    await set({ settings: { ...settings, ...m.patch } });
    return { ok: true };
  },
  'site:enable': (m) => enableSite(String(m.host), m.tabId),
  'site:disable': (m) => disableSite(String(m.host)),
  'picker:save': async (m) => {
    const { pickers = {} } = await get('pickers');
    pickers[m.site] = m.picker;
    await set({ pickers });
    return { ok: true };
  },
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const h = handlers[msg?.type];
  if (!h) return false;
  // 확장 프로그램 내부 화면이나 content.js에서 온 메시지만 처리
  if (sender.id !== chrome.runtime.id) return false;
  serial(() => h(msg))
    .then((r) => sendResponse(r ?? { ok: true }))
    .catch((e) => sendResponse({ ok: false, error: String(e?.message || e) }));
  return true;
});

// ---------- 배지: 오늘까지(지난 것 포함) 못 끝낸 할 일 수 ----------
async function updateBadge() {
  const { todos = [] } = await get('todos');
  const today = ymd(new Date());
  const n = todos.filter((t) => !t.done && t.due && t.due <= today).length;
  await chrome.action.setBadgeText({ text: n ? String(n) : '' });
  await chrome.action.setBadgeBackgroundColor({ color: '#d93025' });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.todos) updateBadge();
});
chrome.runtime.onStartup.addListener(updateBadge);
chrome.runtime.onInstalled.addListener(updateBadge);
