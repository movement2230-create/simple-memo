'use strict';

// ---------- 저장소 ----------
// 확장 프로그램 안에서는 chrome.storage.local, 일반 웹페이지로 미리보기할 때는 localStorage를 사용
const hasChromeStorage = typeof chrome !== 'undefined' && chrome.storage?.local;

const store = {
  async get() {
    if (hasChromeStorage) {
      const { notes = [], activeId = null } = await chrome.storage.local.get(['notes', 'activeId']);
      return { notes, activeId };
    }
    try {
      return JSON.parse(localStorage.getItem('memo-data')) ?? { notes: [], activeId: null };
    } catch {
      return { notes: [], activeId: null };
    }
  },
  async set(data) {
    if (hasChromeStorage) {
      await chrome.storage.local.set(data);
      return;
    }
    const current = await store.get();
    localStorage.setItem('memo-data', JSON.stringify({ ...current, ...data }));
  },
};

// ---------- 상태 ----------
let notes = [];      // [{ id, content, createdAt, updatedAt }]
let activeId = null;
let query = '';

const $ = (id) => document.getElementById(id);
const els = {
  list: $('note-list'),
  emptyList: $('empty-list'),
  search: $('search'),
  newNote: $('new-note'),
  content: $('content'),
  status: $('status'),
  count: $('count'),
  updated: $('updated'),
  del: $('delete'),
  exportBtn: $('export'),
  openTab: $('open-tab'),
};

// ---------- 유틸 ----------
const makeId = () => crypto.randomUUID();

function titleOf(note) {
  const first = note.content.split('\n').find((line) => line.trim()) ?? '';
  return first.trim().slice(0, 60) || '새 메모';
}

function previewOf(note) {
  const lines = note.content.split('\n').filter((line) => line.trim());
  // 목록 기호(-, *, •)는 빼고 내용만 미리보기로
  return (lines[1] ?? '').trim().replace(/^[-*•]\s*/, '').slice(0, 60);
}

function formatTime(ts) {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  }
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString('ko-KR', sameYear
    ? { month: 'short', day: 'numeric' }
    : { year: 'numeric', month: 'short', day: 'numeric' });
}

const activeNote = () => notes.find((n) => n.id === activeId) ?? null;

// ---------- 렌더링 ----------
function renderList() {
  const q = query.trim().toLowerCase();
  const visible = notes
    .filter((n) => !q || n.content.toLowerCase().includes(q))
    .sort((a, b) => b.updatedAt - a.updatedAt);

  els.list.replaceChildren(...visible.map((note) => {
    const li = document.createElement('li');
    li.className = 'note-item' + (note.id === activeId ? ' active' : '');
    li.tabIndex = 0;
    li.dataset.id = note.id;

    const title = document.createElement('div');
    title.className = 'note-title';
    title.textContent = titleOf(note);

    const meta = document.createElement('div');
    meta.className = 'note-meta';
    const preview = previewOf(note);
    meta.textContent = formatTime(note.updatedAt) + (preview ? ` · ${preview}` : '');

    li.append(title, meta);
    return li;
  }));

  els.emptyList.hidden = visible.length > 0;
  els.emptyList.textContent = q ? '검색 결과가 없습니다' : '메모가 없습니다';
}

function renderEditor() {
  const note = activeNote();
  const disabled = !note;
  els.content.disabled = disabled;
  els.del.disabled = disabled;
  els.exportBtn.disabled = disabled;
  const next = note?.content ?? '';
  if (els.content.value !== next) {
    // 다른 창에서 바뀐 내용을 반영할 때 커서 위치는 최대한 유지
    const { selectionStart, selectionEnd } = els.content;
    els.content.value = next;
    els.content.setSelectionRange(Math.min(selectionStart, next.length), Math.min(selectionEnd, next.length));
  }
  renderFooter();
  resetDeleteButton();
}

function renderFooter() {
  const note = activeNote();
  const text = note?.content ?? '';
  els.count.textContent = `${text.length.toLocaleString('ko-KR')}자`;
  els.updated.textContent = note ? `마지막 수정 ${formatTime(note.updatedAt)}` : '';
}

let statusTimer;
function flashStatus(text) {
  els.status.textContent = text;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => { els.status.textContent = ''; }, 1500);
}

// ---------- 동작 ----------
async function persist() {
  try {
    await store.set({ notes, activeId });
    flashStatus('저장됨');
  } catch (err) {
    console.error('메모 저장 실패:', err);
    els.status.textContent = '저장 실패 — 다시 시도해 주세요';
  }
}

async function createNote() {
  const now = Date.now();
  const note = { id: makeId(), content: '', createdAt: now, updatedAt: now };
  notes.push(note);
  activeId = note.id;
  query = '';
  els.search.value = '';
  renderList();
  renderEditor();
  els.content.focus();
  await persist();
}

async function selectNote(id) {
  if (id === activeId) return;
  // 내용 없이 버려진 빈 메모는 다른 메모로 이동할 때 정리
  const prev = activeNote();
  if (prev && !prev.content.trim()) {
    notes = notes.filter((n) => n.id !== prev.id);
  }
  activeId = id;
  renderList();
  renderEditor();
  await store.set({ notes, activeId });
}

async function onInput() {
  const note = activeNote();
  if (!note) return;
  note.content = els.content.value;
  note.updatedAt = Date.now();
  renderList();
  renderFooter();
  await persist();
}

// 삭제는 두 번 눌러야 실행 (실수 방지)
let deleteTimer;
function resetDeleteButton() {
  clearTimeout(deleteTimer);
  els.del.classList.remove('confirm');
  els.del.textContent = '삭제';
}

async function onDelete() {
  const note = activeNote();
  if (!note) return;

  if (!els.del.classList.contains('confirm')) {
    els.del.classList.add('confirm');
    els.del.textContent = '정말 삭제?';
    deleteTimer = setTimeout(resetDeleteButton, 3000);
    return;
  }

  notes = notes.filter((n) => n.id !== note.id);
  const next = [...notes].sort((a, b) => b.updatedAt - a.updatedAt)[0];
  activeId = next?.id ?? null;
  renderList();
  renderEditor();
  await persist();
  flashStatus('삭제됨');
}

function onExport() {
  const note = activeNote();
  if (!note) return;
  const safeName = titleOf(note).replace(/[\\/:*?"<>|]/g, '_').slice(0, 40) || '메모';
  const blob = new Blob([note.content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${safeName}.txt`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function onOpenTab() {
  const url = hasChromeStorage
    ? chrome.runtime.getURL('popup/popup.html?view=tab')
    : `${location.pathname}?view=tab`;
  if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
    await chrome.tabs.create({ url });
    window.close();
  } else {
    window.open(url, '_blank');
  }
}

// ---------- 이벤트 ----------
els.newNote.addEventListener('click', createNote);
els.content.addEventListener('input', onInput);
els.del.addEventListener('click', onDelete);
els.exportBtn.addEventListener('click', onExport);
els.openTab.addEventListener('click', onOpenTab);

els.search.addEventListener('input', () => {
  query = els.search.value;
  renderList();
});

els.list.addEventListener('click', (e) => {
  const item = e.target.closest('.note-item');
  if (item) selectNote(item.dataset.id);
});

els.list.addEventListener('keydown', (e) => {
  const item = e.target.closest('.note-item');
  if (!item) return;
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    selectNote(item.dataset.id).then(() => els.content.focus());
  } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const sibling = e.key === 'ArrowDown' ? item.nextElementSibling : item.previousElementSibling;
    sibling?.focus();
  }
});

document.addEventListener('keydown', (e) => {
  if (e.altKey && e.key.toLowerCase() === 'n') {
    e.preventDefault();
    createNote();
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
    e.preventDefault();
    els.search.focus();
    els.search.select();
  }
});

// 같은 메모를 여러 곳(팝업, 크게 보기 탭 여러 개)에 열어 둔 경우 다른 쪽 변경 사항 반영.
// 지금 이 창에서 입력 중일 때만 편집 영역을 건드리지 않고, 나머지 경우에는 바로 갱신해
// 뒤에 남아 있던 창에서 옛 내용으로 덮어쓰는 일이 없게 한다.
const typingHere = () => document.hasFocus() && document.activeElement === els.content;

if (hasChromeStorage) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.notes) return;
    const incoming = changes.notes.newValue ?? [];
    if (JSON.stringify(incoming) === JSON.stringify(notes)) return;
    notes = incoming;
    if (!activeNote()) activeId = notes[0]?.id ?? null;
    renderList();
    if (!typingHere()) renderEditor();
  });

  // 입력 중에 다른 창에서 바뀐 경우를 대비해, 이 창으로 돌아올 때 최신 내용으로 맞춤
  window.addEventListener('focus', async () => {
    const { notes: latest = [] } = await chrome.storage.local.get('notes');
    if (JSON.stringify(latest) === JSON.stringify(notes)) return;
    notes = latest;
    if (!activeNote()) activeId = notes[0]?.id ?? null;
    renderList();
    renderEditor();
  });
}

// ---------- 시작 ----------
async function init() {
  if (new URLSearchParams(location.search).get('view') === 'tab') {
    document.body.classList.add('tab-mode');
  }

  try {
    ({ notes, activeId } = await store.get());
  } catch (err) {
    console.error('메모 불러오기 실패:', err);
    notes = [];
    activeId = null;
  }

  if (notes.length === 0) {
    await createNote();
    return;
  }
  if (!activeNote()) {
    activeId = [...notes].sort((a, b) => b.updatedAt - a.updatedAt)[0].id;
  }
  renderList();
  renderEditor();
  els.content.focus();
  // 커서를 메모 끝으로
  els.content.setSelectionRange(els.content.value.length, els.content.value.length);
}

init();
