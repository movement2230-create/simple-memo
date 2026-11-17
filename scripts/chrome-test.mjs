// 설치된 실제 Chrome을 임시 프로필로 띄워 확장 프로그램을 로드하고 기능을 점검합니다.
// 평소 쓰는 Chrome 프로필은 건드리지 않으며, 창 없이(headless) 실행됩니다.
// 사용법 (프로젝트 루트에서): node scripts/chrome-test.mjs
// 결과: test-results/results.txt 와 스크린샷 (git에는 올라가지 않음)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXT = path.resolve(process.argv[2] ?? ROOT);
const OUT = path.resolve(process.argv[3] ?? path.join(ROOT, 'test-results'));
const CHROME = process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
fs.mkdirSync(OUT, { recursive: true });
const DL = path.join(OUT, 'downloads');
fs.rmSync(DL, { recursive: true, force: true });
fs.mkdirSync(DL, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'memo-test-'));

const results = [];
const problems = [];
const check = (name, ok, detail = '') => {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) problems.push(name);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- CDP over pipe ----------
const chrome = spawn(CHROME, [
  '--headless=new',
  '--remote-debugging-pipe',
  '--enable-unsafe-extension-debugging',
  `--user-data-dir=${profile}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-gpu',
  '--window-size=1280,800',
  'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });

const toChrome = chrome.stdio[3];
const fromChrome = chrome.stdio[4];
let nextId = 1;
const pending = new Map();
const listeners = [];
let buf = '';
fromChrome.on('data', (chunk) => {
  buf += chunk.toString('utf8');
  let i;
  while ((i = buf.indexOf('\0')) >= 0) {
    const msg = JSON.parse(buf.slice(0, i));
    buf = buf.slice(i + 1);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    } else if (msg.method) {
      listeners.forEach((fn) => fn(msg));
    }
  }
});
function send(method, params = {}, sessionId) {
  const id = nextId++;
  const msg = { id, method, params };
  if (sessionId) msg.sessionId = sessionId;
  toChrome.write(JSON.stringify(msg) + '\0');
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    setTimeout(() => pending.has(id) && reject(new Error(`timeout: ${method}`)), 15000);
  });
}
function waitEvent(pred, ms = 10000) {
  return new Promise((resolve, reject) => {
    const fn = (m) => { if (pred(m)) { listeners.splice(listeners.indexOf(fn), 1); resolve(m); } };
    listeners.push(fn);
    setTimeout(() => { const k = listeners.indexOf(fn); if (k >= 0) { listeners.splice(k, 1); reject(new Error('event timeout')); } }, ms);
  });
}

// 콘솔 오류·예외 수집
const consoleErrors = [];
listeners.push((m) => {
  if (m.method === 'Runtime.exceptionThrown') {
    consoleErrors.push(`exception: ${m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text}`);
  } else if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning')) {
    consoleErrors.push(`console.${m.params.type}: ${m.params.args.map((a) => a.value ?? a.description).join(' ')}`);
  } else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
    consoleErrors.push(`log: ${m.params.entry.text} ${m.params.entry.url ?? ''}`);
  }
});

// ---------- 페이지 도우미 ----------
async function attach(targetId) {
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Page.enable', {}, sessionId);
  await send('Runtime.enable', {}, sessionId);
  await send('Log.enable', {}, sessionId);
  return sessionId;
}
async function open(url, width = 640, height = 480) {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const s = await attach(targetId);
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }, s);
  const loaded = waitEvent((m) => m.sessionId === s && m.method === 'Page.loadEventFired');
  await send('Page.navigate', { url }, s);
  await loaded;
  await sleep(400);
  return { s, targetId };
}
async function evaluate(s, expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, s);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
}
async function click(s, selector) {
  const rect = await evaluate(s, `(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', { type, x: rect.x, y: rect.y, button: 'left', clickCount: 1 }, s);
  }
  await sleep(250);
}
async function type(s, text) {
  await send('Input.insertText', { text }, s);
  await sleep(250);
}
async function key(s, keyName, code, modifiers = 0, keyCode) {
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: keyName, code, modifiers, windowsVirtualKeyCode: keyCode }, s);
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: keyName, code, modifiers, windowsVirtualKeyCode: keyCode }, s);
  await sleep(250);
}
async function shot(s, file) {
  const { data } = await send('Page.captureScreenshot', { format: 'png' }, s);
  fs.writeFileSync(path.join(OUT, file), Buffer.from(data, 'base64'));
}
const storage = (s) => evaluate(s, `chrome.storage.local.get(null)`);
const titles = (s) => evaluate(s, `[...document.querySelectorAll('.note-title')].map(e => e.textContent)`);

// ---------- 테스트 ----------
try {
  const { id: extId } = await send('Extensions.loadUnpacked', { path: EXT });
  check('확장 프로그램 로드 (manifest 오류 없음)', !!extId, `ID ${extId}`);
  const POPUP = `chrome-extension://${extId}/popup/popup.html`;

  // 1. 처음 열기
  let p = await open(POPUP);
  let st = await storage(p.s);
  check('처음 열면 빈 메모 1개 생성', st.notes?.length === 1 && st.notes[0].content === '', JSON.stringify(st.notes?.length));
  check('편집 영역에 바로 포커스', await evaluate(p.s, `document.activeElement.id`) === 'content');
  const size = await evaluate(p.s, `[document.body.offsetWidth, document.body.offsetHeight]`);
  check('팝업 크기 640×480', size[0] === 640 && size[1] === 480, size.join('×'));

  // 2. 입력 → 자동 저장
  await type(p.s, '장보기 목록\n우유, 계란, 사과');
  st = await storage(p.s);
  check('입력 즉시 chrome.storage에 저장', st.notes[0].content === '장보기 목록\n우유, 계란, 사과');
  check('목록 제목이 첫 줄로 표시', (await titles(p.s))[0] === '장보기 목록');
  check('글자 수 표시', await evaluate(p.s, `document.getElementById('count').textContent`) === '17자');

  // 3. ＋ 버튼으로 새 메모
  await click(p.s, '#new-note');
  await type(p.s, '회의 메모\n- 목요일 오후 3시 디자인 리뷰');
  // 4. Alt+N 단축키로 새 메모
  await key(p.s, 'n', 'KeyN', 1, 78);
  await type(p.s, '여행 준비물\n여권, 충전기');
  st = await storage(p.s);
  check('＋ 버튼과 Alt+N으로 새 메모 생성', st.notes.length === 3, `${st.notes.length}개`);
  check('최근 수정한 메모가 맨 위', JSON.stringify(await titles(p.s)) === JSON.stringify(['여행 준비물', '회의 메모', '장보기 목록']), (await titles(p.s)).join(', '));
  check('미리보기에서 목록 기호 제거', (await evaluate(p.s, `document.querySelectorAll('.note-meta')[1].textContent`)).includes('· 목요일'));
  await shot(p.s, '1-popup-light.png');

  // 5. 빈 메모 정리
  await click(p.s, '#new-note');
  await click(p.s, '.note-item:nth-child(2)');
  st = await storage(p.s);
  check('내용 없는 새 메모는 다른 메모로 이동하면 정리', st.notes.length === 3, `${st.notes.length}개`);

  // 6. 검색 (Ctrl+F로 포커스)
  await key(p.s, 'f', 'KeyF', 2, 70);
  check('Ctrl+F로 검색창 포커스', await evaluate(p.s, `document.activeElement.id`) === 'search');
  await type(p.s, '계란');
  check('검색 결과', JSON.stringify(await titles(p.s)) === '["장보기 목록"]', (await titles(p.s)).join(', '));
  await type(p.s, '없는단어');
  check('검색 결과 없음 안내', await evaluate(p.s, `!document.getElementById('empty-list').hidden && document.getElementById('empty-list').textContent`) === '검색 결과가 없습니다');
  await evaluate(p.s, `(() => { const s = document.getElementById('search'); s.value = ''; s.dispatchEvent(new Event('input')); })()`);

  // 7. 키보드로 목록 이동
  await evaluate(p.s, `document.querySelector('.note-item').focus()`);
  await key(p.s, 'ArrowDown', 'ArrowDown', 0, 40);
  await key(p.s, 'Enter', 'Enter', 0, 13);
  check('방향키+Enter로 메모 선택', (await evaluate(p.s, `document.getElementById('content').value`)).startsWith('회의 메모') && await evaluate(p.s, `document.activeElement.id`) === 'content');

  // 8. 다크 모드 스크린샷
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] }, p.s);
  await sleep(200);
  check('다크 모드 배경색', await evaluate(p.s, `getComputedStyle(document.body).backgroundColor`) === 'rgb(30, 30, 29)');
  await shot(p.s, '2-popup-dark.png');
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] }, p.s);

  // 9. 삭제 (두 번 눌러야 삭제)
  await click(p.s, '#delete');
  check('삭제 첫 클릭은 확인 단계', await evaluate(p.s, `document.getElementById('delete').textContent`) === '정말 삭제?' && (await storage(p.s)).notes.length === 3);
  await sleep(3300);
  check('3초 지나면 삭제 확인 취소', await evaluate(p.s, `document.getElementById('delete').textContent`) === '삭제');
  await click(p.s, '#delete');
  await click(p.s, '#delete');
  st = await storage(p.s);
  check('두 번 누르면 삭제', st.notes.length === 2 && !st.notes.some((n) => n.content.startsWith('회의 메모')), `${st.notes.length}개`);

  // 10. 내보내기 (.txt 다운로드)
  await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DL, eventsEnabled: true });
  const done = waitEvent((m) => m.method === 'Browser.downloadProgress' && m.params.state !== 'inProgress', 10000);
  const willBegin = waitEvent((m) => m.method === 'Browser.downloadWillBegin', 10000);
  await click(p.s, '#export');
  const begin = await willBegin;
  const prog = await done;
  await sleep(300);
  const files = fs.readdirSync(DL);
  const exported = files.length ? fs.readFileSync(path.join(DL, files[0]), 'utf8') : '';
  const activeNow = await evaluate(p.s, `document.getElementById('content').value`);
  check('내보내기 .txt 다운로드', prog.params.state === 'completed' && exported === activeNow, `${begin.params.suggestedFilename}, ${Buffer.byteLength(exported)}바이트`);

  // 11. 팝업을 닫았다 다시 열어도 유지
  await send('Target.closeTarget', { targetId: p.targetId });
  await sleep(300);
  p = await open(POPUP);
  check('다시 열어도 메모 유지', JSON.stringify(await titles(p.s)) === '["장보기 목록","여행 준비물"]' || (await titles(p.s)).length === 2, (await titles(p.s)).join(', '));
  check('마지막에 보던 메모가 다시 열림', await evaluate(p.s, `document.getElementById('content').value`) === activeNow);

  // 12. 크게 보기 → 새 탭
  const created = waitEvent((m) => m.method === 'Target.targetCreated' && m.params.targetInfo.url.includes('view=tab'), 5000).catch(() => null);
  await send('Target.setDiscoverTargets', { discover: true });
  await click(p.s, '#open-tab');
  const tabTarget = await created;
  check('크게 보기 버튼이 새 탭을 엶', !!tabTarget, tabTarget?.params.targetInfo.url ?? '');
  if (tabTarget) {
    const ts = await attach(tabTarget.params.targetInfo.targetId);
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false }, ts);
    await sleep(600);
    check('탭에서는 넓은 화면 모드', await evaluate(ts, `document.body.classList.contains('tab-mode') && document.body.offsetWidth === 1280`));
    await shot(ts, '3-tab-view.png');

    // 13. 팝업과 탭 사이 동기화
    // 두 번째 '크게 보기' 탭을 열어 두고(편집 영역에 포커스가 남은 상태), 첫 탭에서 수정
    const t2 = await open(`${POPUP}?view=tab`, 1280, 800);
    await send('Target.activateTarget', { targetId: tabTarget.params.targetInfo.targetId });
    await sleep(300);
    const focusInfo = await evaluate(t2.s, `[document.hasFocus(), document.activeElement.id]`);
    await evaluate(ts, `document.getElementById('content').focus(); document.getElementById('content').setSelectionRange(1e9, 1e9)`);
    await type(ts, '\n탭에서 추가한 줄');
    await sleep(400);
    const otherValue = await evaluate(t2.s, `document.getElementById('content').value`);
    check('한 탭에서 고친 내용이 뒤에 열린 다른 탭 편집 영역에도 반영', otherValue.endsWith('탭에서 추가한 줄'), `뒤쪽 탭 hasFocus=${focusInfo[0]}, activeElement=${focusInfo[1]}`);

    // 뒤쪽 탭으로 돌아가 이어서 입력해도 앞서 고친 내용이 지워지지 않아야 함
    await send('Target.activateTarget', { targetId: t2.targetId });
    await evaluate(t2.s, `window.dispatchEvent(new Event('focus')); document.getElementById('content').focus(); document.getElementById('content').setSelectionRange(1e9, 1e9)`);
    await sleep(300);
    await type(t2.s, '\n두 번째 탭에서 추가');
    const finalStore = await storage(t2.s);
    const finalNote = finalStore.notes.find((n) => n.id === finalStore.activeId);
    check('번갈아 고쳐도 내용이 덮어써지지 않음', finalNote.content.includes('탭에서 추가한 줄') && finalNote.content.endsWith('두 번째 탭에서 추가'), JSON.stringify(finalNote.content.split('\n').slice(-2)));
  }
  check('팝업 열기 후 크게 보기를 누르면 팝업 닫힘(window.close)', !(await send('Target.getTargets')).targetInfos.some((t) => t.targetId === p.targetId));
} catch (err) {
  check('테스트 실행 중 오류', false, err.message);
} finally {
  results.push('', '콘솔 오류/경고:', ...(consoleErrors.length ? consoleErrors : ['없음']));
  if (consoleErrors.length) problems.push('console');
  fs.writeFileSync(path.join(OUT, 'results.txt'), results.join('\n'), 'utf8');
  console.log(results.join('\n'));
  console.log(problems.length ? `\n실패 ${problems.length}건` : '\n모두 통과');
  try { await send('Browser.close'); } catch {}
  setTimeout(() => { chrome.kill(); fs.rmSync(profile, { recursive: true, force: true }); process.exit(problems.length ? 1 : 0); }, 500);
}
