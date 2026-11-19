// 실제 Chromium에 확장 프로그램을 올려 가짜 메일함 3종에서 동작을 점검합니다.
// 필요: Playwright (npm i -D playwright && npx playwright install chromium)
// 실행: node mail-todo/tests/browser-test.mjs   → 결과와 스크린샷은 mail-todo/test-results/
//
// 사이트 권한은 원래 사용자가 팝업에서 허용해야 하므로, 테스트용 복사본의 manifest에만
// 가짜 메일함 주소의 권한을 미리 넣어 둡니다(실제 확장 프로그램에는 넣지 않음).
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

// 전역 설치된 Playwright도 찾도록 require 사용
const { chromium } = createRequire(import.meta.url)('playwright');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'test-results');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const results = [];
let failed = 0;
const check = (name, ok, detail = '') => {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failed++;
};

// ---------- 테스트용 확장 프로그램 복사본 ----------
const ext = fs.mkdtempSync(path.join(os.tmpdir(), 'mail-todo-ext-'));
for (const p of ['manifest.json', 'src', 'pages', 'icons']) fs.cpSync(path.join(ROOT, p), path.join(ext, p), { recursive: true });
const manifest = JSON.parse(fs.readFileSync(path.join(ext, 'manifest.json'), 'utf8'));
manifest.host_permissions = ['*://127.0.0.1/*', '*://mail.google.com/*', '*://mail.naver.com/*', '*://localhost/*'];
fs.writeFileSync(path.join(ext, 'manifest.json'), JSON.stringify(manifest, null, 2));

// ---------- 가짜 메일함 ----------
const row = (subject, i) => `<li class="mail-item ${i % 2 ? 'unread' : 'read'}"><input type="checkbox"><span class="sender">홍길동${i}</span><a class="subject" href="/mail/${i}">${subject}</a><span class="date">11-19</span></li>`;
const GROUPWARE = `<!doctype html><meta charset="utf-8"><title>사내 메일</title>
<nav><div class="subject">받은편지함</div></nav>
<ul id="list">${[
  '[결재요청] 11월 법인카드 사용내역 승인 부탁드립니다 (11/25까지)',
  'RE: 3분기 실적 보고서 검토 요청',
  '오늘 오후 3시 주간 회의 참석 바랍니다',
  '[긴급] 고객사 장애 대응 회신 요청',
  '점심 메뉴 공유',
  '(광고) 연말 특가 11/30까지',
].map(row).join('')}</ul>
<script>
  // 2초 뒤 새 메일 도착 (자동 감지 확인)
  setTimeout(() => document.getElementById('list').insertAdjacentHTML('afterbegin', ${JSON.stringify(row('다음 주 수요일 워크숍 자료 제출 요청', 99))}), 2500);
</script>`;

const GMAIL = `<!doctype html><meta charset="utf-8"><title>Gmail</title><table><tbody>${[
  ['Please review the Q4 budget by Friday', '18a1'],
  ['Weekly newsletter #42', '18a2'],
  ['계약서 초안 회신 부탁드립니다', '18a3'],
].map(([s, id], i) => `<tr class="zA ${i ? 'yO' : 'zE'}"><td><div class="yW"><span class="yP" email="pm${i}@partner.com" name="Kim PM${i}">Kim PM${i}</span></div></td><td><div class="y6"><span class="bog"><span data-legacy-thread-id="${id}">${s}</span></span></div></td></tr>`).join('')}</tbody></table>`;

// 네이버 메일형: 제목이 mail_title 안의 링크
const NAVER = `<!doctype html><meta charset="utf-8"><title>네이버 메일</title><ol>${[
  '[스마트스토어] 정산 서류 제출 요청 (11/27까지)',
  '네이버페이 결제완료 안내',
  '동창회 참석 여부 회신 부탁해',
].map((s, i) => `<li class="mail_item"><div class="mail_sender">보낸이${i}</div><div class="mail_title"><a class="mail_title_link" href="#read/${i}"><span class="text">${s}</span></a></div></li>`).join('')}</ol>`;

// 클래스 이름이 무작위라 자동으로는 못 찾는 메일함 → "목록 직접 지정" 필요
const OBFUSCATED = `<!doctype html><meta charset="utf-8"><title>Web Mail</title><div role="listbox">${[
  '내일까지 견적서 제출 부탁드립니다',
  '보안 교육 이수 요청 (이번 주 금요일)',
  '사내 동호회 안내',
].map((s) => `<div role="option" class="xQ7a jK2b"><div class="r1"><span class="Aa9">김철수</span><span class="Bb3">${s}</span></div><span class="Cc1">오전 9:12</span></div>`).join('')}</div>`;

const server = http.createServer((req, res) => {
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(req.url.startsWith('/webmail') ? OBFUSCATED : GROUPWARE);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;

// ---------- 브라우저 ----------
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mail-todo-profile-'));
const ctx = await chromium.launchPersistentContext(profile, {
  headless: true,
  // 확장 프로그램은 headless shell이 아닌 전체 Chromium에서만 동작 (CHROME_PATH로 바꿀 수 있음)
  channel: process.env.CHROME_PATH ? undefined : 'chromium',
  executablePath: process.env.CHROME_PATH,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  viewport: { width: 1280, height: 860 },
  deviceScaleFactor: 2,
});
await ctx.route('https://mail.google.com/**', (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: GMAIL }));
await ctx.route('https://mail.naver.com/**', (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: NAVER }));

let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent('serviceworker');
const extId = new URL(sw.url()).host;
const extUrl = (p) => `chrome-extension://${extId}/${p}`;

const errors = [];
ctx.on('page', (p) => p.on('pageerror', (e) => errors.push(`${p.url()}: ${e.message}`)));

// 확장 프로그램 화면에서 백그라운드로 메시지 보내기
const dash = await ctx.newPage();
dash.on('pageerror', (e) => errors.push(`dashboard: ${e.message}`));
await dash.goto(extUrl('pages/dashboard.html'));
const bg = (msg) => dash.evaluate((m) => chrome.runtime.sendMessage(m), msg);
const getTodos = () => dash.evaluate(async () => (await chrome.storage.local.get('todos')).todos || []);
const waitFor = async (fn, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 200)); }
  return false;
};

for (const host of ['127.0.0.1', 'mail.google.com', 'mail.naver.com']) await bg({ type: 'site:enable', host });

// 1) 일반 그룹웨어형: class="subject" 자동 인식
const gw = await ctx.newPage();
await gw.goto(`http://127.0.0.1:${PORT}/inbox`);
await waitFor(async () => (await getTodos()).length >= 4);
let todos = await getTodos();
const titles = todos.map((t) => t.title);
check('그룹웨어: 할 일 메일 4개를 찾음', todos.length === 4, titles.join(' | '));
check('그룹웨어: 메뉴의 "받은편지함"은 제목으로 안 읽음', !titles.some((t) => t.includes('받은편지함')));
check('그룹웨어: 광고·잡담 제외', !titles.some((t) => /광고|점심/.test(t)));
check('그룹웨어: RE: 제거', titles.includes('3분기 실적 보고서 검토 요청'));
const card = todos.find((t) => t.title.includes('법인카드'));
check('그룹웨어: 11/25 마감일', card?.due?.endsWith('-11-25'), card?.due);
check('그룹웨어: 메일 링크 저장', /\/mail\/\d+$/.test(card?.link || ''), card?.link);
const meeting = todos.find((t) => t.title.includes('주간 회의'));
check('그룹웨어: 오늘 15:00', meeting?.dueTime === '15:00', `${meeting?.due} ${meeting?.dueTime}`);
check('그룹웨어: 보낸 사람 읽기', card?.sender === '홍길동0', card?.sender);
check('그룹웨어: 긴급은 우선순위 높음', todos.find((t) => t.title.includes('긴급'))?.priority === 'high');
const gotNew = await waitFor(async () => (await getTodos()).some((t) => t.title.includes('워크숍')), 8000);
check('그룹웨어: 새로 도착한 메일도 자동으로 읽음', gotNew);

// 2) Gmail형 전용 인식
const gm = await ctx.newPage();
await gm.goto('https://mail.google.com/mail/u/0/#inbox');
await waitFor(async () => (await getTodos()).some((t) => t.site === 'mail.google.com' && t.title.includes('계약서')));
todos = await getTodos();
const gmTodos = todos.filter((t) => t.site === 'mail.google.com');
check('Gmail형: 할 일 2개(뉴스레터 제외)', gmTodos.length === 2, gmTodos.map((t) => t.title).join(' | '));
check('Gmail형: 보낸 사람 이름과 메일 주소', gmTodos.some((t) => t.sender === 'Kim PM0 <pm0@partner.com>'), gmTodos.map((t) => t.sender).join(' | '));
check('Gmail형: 스레드 링크', gmTodos.some((t) => t.link.endsWith('#all/18a1')));

// 2-1) 네이버 메일형
const nv = await ctx.newPage();
await nv.goto('https://mail.naver.com/v2/folders/0/all');
await waitFor(async () => (await getTodos()).filter((t) => t.site === 'mail.naver.com').length >= 2);
const nvTodos = (await getTodos()).filter((t) => t.site === 'mail.naver.com');
check('네이버형: 할 일 2개(결제완료 안내 제외)', nvTodos.length === 2, nvTodos.map((t) => `${t.title}(${t.due})`).join(' | '));
check('네이버형: 보낸 사람이 제목에 섞이지 않음', !nvTodos.some((t) => t.title.includes('보낸이')));
check('네이버형: 보낸 사람 읽기', nvTodos.every((t) => /^보낸이\d$/.test(t.sender)), nvTodos.map((t) => t.sender).join(' | '));

// 3) 알아보기 어려운 메일함: 자동으로 못 찾고, 직접 지정하면 찾음
await bg({ type: 'site:enable', host: 'localhost' });
const wm = await ctx.newPage();
await wm.goto(`http://localhost:${PORT}/webmail`);
await wm.waitForTimeout(2500);
check('직접 지정 전: 엉뚱한 할 일을 만들지 않음', !(await getTodos()).some((t) => t.site === 'localhost'));
const wmTabId = await dash.evaluate(async (u) => (await chrome.tabs.query({ url: u }))[0]?.id, `http://localhost:${PORT}/webmail`);
await dash.evaluate((id) => chrome.tabs.sendMessage(id, { type: 'pick' }), wmTabId);
await wm.screenshot({ path: path.join(OUT, '3-pick-mode.png') });
await wm.getByText('보안 교육 이수 요청').click();
const pageText = () => wm.evaluate(() => document.documentElement.textContent); // 안내 문구는 <html> 바로 아래에 붙음
check('직접 지정: 보낸 사람을 못 찾으면 보낸 사람도 클릭하라고 안내', await waitFor(async () => (await pageText()).includes('보낸 사람 이름을 클릭'), 3000));
await wm.screenshot({ path: path.join(OUT, '3-pick-sender.png') });
await wm.getByText('김철수').nth(1).click();
await waitFor(async () => (await getTodos()).filter((t) => t.site === 'localhost' && t.sender).length >= 2);
const wmTodos = (await getTodos()).filter((t) => t.site === 'localhost');
check('직접 지정 후: 할 일 2개(동호회 안내 제외)', wmTodos.length === 2, wmTodos.map((t) => `${t.title}(${t.due})`).join(' | '));
check('직접 지정 후: 보낸 사람·시간이 제목에 섞이지 않음', !wmTodos.some((t) => /김철수|오전/.test(t.title)));
check('직접 지정 후: 결과 안내', await waitFor(async () => /보낸 사람 \d+개를 찾았어요/.test(await pageText()), 3000), (await pageText()).match(/제목 \d+개[^\n]*/)?.[0]);
check('직접 지정 후: 보낸 사람 읽기', wmTodos.every((t) => t.sender === '김철수'), wmTodos.map((t) => t.sender).join(' | '));
await wm.screenshot({ path: path.join(OUT, '3-pick-result.png') });

// 3-1) 메일함 이름·색 자동 지정
const boxes = await dash.evaluate(async () => (await chrome.storage.local.get('settings')).settings?.mailboxes || {});
check('메일함 이름: 구글/네이버 자동, 그 밖은 사내', boxes['mail.google.com']?.name === '구글' && boxes['mail.naver.com']?.name === '네이버' && boxes['127.0.0.1']?.name === '사내' && boxes.localhost?.name === '사내', JSON.stringify(Object.fromEntries(Object.entries(boxes).map(([k, v]) => [k, v.name]))));
check('메일함 색: 사내 메일함 둘은 서로 다른 색', boxes['127.0.0.1']?.color !== boxes.localhost?.color);

// 4) 달력
await dash.bringToFront();
await dash.reload();
await dash.waitForSelector('.chip');
await dash.screenshot({ path: path.join(OUT, '1-calendar.png'), fullPage: true });
const chipsInGrid = await dash.locator('#calGrid .chip').count();
const withDue = (await getTodos()).filter((t) => t.due && !t.done).length;
check('달력: 마감일 있는 할 일이 모두 표시됨', chipsInGrid === withDue, `${chipsInGrid}/${withDue}`);

// 메일함 골라 보기: 구글을 끄면 구글 할 일이 달력에서 사라짐
const googleDue = (await getTodos()).filter((t) => t.site === 'mail.google.com' && t.due && !t.done).map((t) => t.id);
const gBtn = dash.locator('.mb-toggle', { hasText: '구글' });
check('메일함 버튼 줄에 엉뚱한 글자 없음', !(await dash.textContent('#mbBar')).includes('null'));
check('메일함 버튼 표시(구글·네이버·사내)', (await gBtn.count()) === 1 && (await dash.locator('.mb-toggle', { hasText: '네이버' }).count()) === 1 && (await dash.locator('.mb-toggle', { hasText: '사내' }).count()) >= 1);
await gBtn.click();
const hiddenOk = await waitFor(async () => {
  for (const id of googleDue) if (await dash.locator(`#calGrid .chip[data-id="${id}"]`).count()) return false;
  return true;
}, 3000);
check('메일함 골라 보기: 구글을 끄면 구글 할 일이 숨겨짐', googleDue.length > 0 && hiddenOk, `${googleDue.length}개`);
check('메일함 골라 보기: 다른 메일함 할 일은 그대로', (await dash.locator('#calGrid .chip').count()) === withDue - googleDue.length);
await dash.screenshot({ path: path.join(OUT, '1-calendar-filter.png'), fullPage: true });
await gBtn.click();
check('메일함 골라 보기: 다시 켜면 표시', await waitFor(async () => (await dash.locator('#calGrid .chip').count()) === withDue, 3000));

// 마감일 없는 할 일을 달력으로 끌어다 놓기
todos = await getTodos();
const noDue = todos.find((t) => !t.due);
const target = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-28`;
if (noDue) {
  await dash.locator(`#noDueList .chip[data-id="${noDue.id}"]`).dragTo(dash.locator(`.day[data-date="${target}"]`));
  const moved = await waitFor(async () => (await getTodos()).find((t) => t.id === noDue.id)?.due === target, 3000);
  check('달력: 끌어다 놓으면 마감일 변경', moved, noDue.title);
} else {
  check('달력: 마감일 없는 할 일 존재(끌어놓기 시험용)', false);
}

// 할 일 수정
const editId = todos.find((t) => t.title.includes('법인카드')).id;
await dash.locator(`#calGrid .chip[data-id="${editId}"] .t`).click();
await dash.fill('#fTitle', '법인카드 사용내역 승인');
await dash.fill('#fDue', target);
await dash.fill('#fTime', '10:00');
await dash.selectOption('#fPriority', 'high');
await dash.fill('#fMemo', '재무팀 김과장님께 확인');
await dash.screenshot({ path: path.join(OUT, '2-edit.png') });
await dash.click('#editForm button[type="submit"]');
await waitFor(async () => (await getTodos()).find((t) => t.id === editId)?.edited);
const edited = (await getTodos()).find((t) => t.id === editId);
check('수정: 제목·마감·시간·우선순위·메모 저장', edited.title === '법인카드 사용내역 승인' && edited.due === target && edited.dueTime === '10:00' && edited.priority === 'high' && edited.memo.includes('김과장'), JSON.stringify({ t: edited.title, d: edited.due, h: edited.dueTime, p: edited.priority }));

// 완료 체크
await dash.locator(`#calGrid .chip[data-id="${editId}"] .chk`).click();
check('완료: 체크하면 완료 처리', await waitFor(async () => (await getTodos()).find((t) => t.id === editId)?.done, 3000));
check('완료: 기본 설정에서는 달력에서 숨김', await waitFor(async () => (await dash.locator(`#calGrid .chip[data-id="${editId}"]`).count()) === 0, 3000));

// 직접 추가
await dash.locator(`.day[data-date="${target}"] .add`).click({ force: true });
await dash.fill('#fTitle', '팀 회식 장소 예약');
await dash.click('#editForm button[type="submit"]');
check('추가: 날짜 칸의 + 로 할 일 추가', await waitFor(async () => (await getTodos()).some((t) => t.title === '팀 회식 장소 예약' && t.due === target && t.source === 'manual' && t.site === ''), 3000));

// 직접 추가하면서 메일함 고르기
await dash.click('#addBtn');
await dash.fill('#fTitle', '동창회 회비 입금');
await dash.selectOption('#fMailbox', 'mail.naver.com');
await dash.click('#editForm button[type="submit"]');
check('추가: 메일함을 골라서 추가', await waitFor(async () => (await getTodos()).some((t) => t.title === '동창회 회비 입금' && t.site === 'mail.naver.com'), 3000));

// 사용자가 삭제한 메일 할 일은 다시 생기지 않음
const delId = (await getTodos()).find((t) => t.title.includes('긴급')).id;
await bg({ type: 'todo:delete', id: delId });
await gw.reload();
await gw.waitForTimeout(3000);
check('삭제: 메일함을 다시 읽어도 지운 할 일이 되살아나지 않음', !(await getTodos()).some((t) => t.title.includes('긴급')));

await dash.screenshot({ path: path.join(OUT, '1-calendar-after.png'), fullPage: true });

// 5) 목록, 설정, 팝업
await dash.click('.tabs button[data-tab="list"]');
await dash.waitForSelector('.todo-row');
await dash.screenshot({ path: path.join(OUT, '4-list.png'), fullPage: true });
check('목록: 표시', (await dash.locator('.todo-row').count()) > 0);
await dash.click('.tabs button[data-tab="settings"]');
await dash.waitForFunction(() => document.getElementById('aiState').textContent !== '확인 중…');
// 메일함 이름 바꾸기
const nameInput = dash.locator('#siteList li', { hasText: '127.0.0.1' }).locator('.mb-name');
await nameInput.fill('우리회사');
await nameInput.press('Enter');
await nameInput.blur();
check('설정: 메일함 이름 바꾸기', await waitFor(async () => (await dash.evaluate(async () => (await chrome.storage.local.get('settings')).settings.mailboxes['127.0.0.1'].name)) === '우리회사', 3000));
await dash.screenshot({ path: path.join(OUT, '5-settings.png'), fullPage: true });
check('설정 탭에서는 메일함 버튼 숨김', !(await dash.isVisible('#mbBar')));
check('설정: 켠 메일함 4개 표시', (await dash.locator('#siteList li').count()) === 4);
check('설정: 내장 AI 상태 표시', (await dash.textContent('#aiState')).length > 0, await dash.textContent('#aiState'));

// 규칙 수정 → 반영
await dash.fill('#ruleTask', '품의\n검토');
await dash.click('#saveRules');
await waitFor(async () => (await dash.evaluate(async () => (await chrome.storage.local.get('settings')).settings?.rules?.taskKeywords?.length)) === 2, 3000);
await bg({ type: 'subjects', site: 'test', items: [{ subject: '출장 품의서 올렸습니다' }, { subject: '자료 제출 부탁드립니다' }] });
await bg({ type: 'settings:set', patch: { rules: { taskKeywords: ['검토'], vipSenders: ['김부장'], excludeSenders: ['no-reply'] } } });
await bg({ type: 'subjects', site: 'test2', items: [{ subject: '예산안 검토', sender: '김부장 <boss@co.kr>' }, { subject: '주문 검토', sender: 'no-reply@shop.com' }] });
const t2 = (await getTodos()).filter((t) => t.site === 'test2');
check('규칙: 중요한 보낸 사람은 우선순위 높음', t2.length === 1 && t2[0].priority === 'high' && t2[0].sender === '김부장 <boss@co.kr>', JSON.stringify(t2.map((t) => [t.title, t.priority, t.sender])));
todos = (await getTodos()).filter((t) => t.site === 'test');
check('규칙: 사용자가 바꾼 단어로 판단', todos.length === 1 && todos[0].title.includes('품의서'), todos.map((t) => t.title).join(' | '));

// 6) 사이드 패널: 위 달력, 아래 목록
const behavior = await sw.evaluate(() => chrome.sidePanel.getPanelBehavior());
check('사이드 패널: 툴바 아이콘을 누르면 패널이 열리도록 설정', behavior.openPanelOnActionClick === true);
const panel = await ctx.newPage();
panel.on('pageerror', (e) => errors.push(`sidepanel: ${e.message}`));
await panel.setViewportSize({ width: 400, height: 900 });
await panel.goto(extUrl('pages/sidepanel.html'));
await panel.waitForSelector('.mc-day');
await panel.waitForSelector('.sp-item');
const calBox = await panel.locator('.mini-cal').boundingBox();
const listBox = await panel.locator('.sp-list').boundingBox();
check('사이드 패널: 달력이 위, 목록이 아래', calBox.y < listBox.y, `달력 y=${Math.round(calBox.y)}, 목록 y=${Math.round(listBox.y)}`);
check('사이드 패널: 가로 스크롤 없음', await panel.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
const openShown = (await getTodos()).filter((t) => !t.done).length;
check('사이드 패널: 끝내지 않은 할 일이 목록에 모두 표시', (await panel.locator('.sp-item').count()) === openShown, `${await panel.locator('.sp-item').count()}/${openShown}`);
const dotsOn28 = await panel.locator(`.mc-day[data-date="${target}"] .mb-dot`).count();
check('사이드 패널: 할 일 있는 날짜에 메일함 색 점', dotsOn28 > 0, `${target}: ${dotsOn28}개`);
await panel.screenshot({ path: path.join(OUT, '6-sidepanel.png') });

check('사이드 패널: 목록에 보낸 사람 표시', (await panel.locator('.sp-item .sender', { hasText: '홍길동' }).count()) > 0);
await panel.fill('#listSearch', 'Kim PM');
check('사이드 패널: 보낸 사람으로 검색', await waitFor(async () => (await panel.locator('.sp-item').count()) === (await getTodos()).filter((t) => !t.done && (t.sender || '').includes('Kim PM')).length, 3000));
await panel.fill('#listSearch', '');

// 날짜를 누르면 그날 할 일만
await panel.click(`.mc-day[data-date="${target}"]`);
const onTarget = (await getTodos()).filter((t) => !t.done && t.due === target).length;
check('사이드 패널: 날짜를 누르면 그날 할 일만', await waitFor(async () => (await panel.locator('.sp-item').count()) === onTarget, 3000), `${onTarget}개, 제목 "${await panel.textContent('#listTitle')}"`);
await panel.screenshot({ path: path.join(OUT, '6-sidepanel-day.png') });
await panel.click('#clearDay');
check('사이드 패널: 전체 보기로 돌아가기', await waitFor(async () => (await panel.locator('.sp-item').count()) === openShown, 3000));

// 목록에서 달력 날짜로 끌어 놓기
const dragT = (await getTodos()).find((t) => !t.done && !t.due);
const day3 = `${target.slice(0, 8)}03`;
await panel.locator(`.sp-item[data-id="${dragT.id}"]`).dragTo(panel.locator(`.mc-day[data-date="${day3}"]`));
check('사이드 패널: 목록의 할 일을 달력 날짜로 끌면 마감일 변경', await waitFor(async () => (await getTodos()).find((t) => t.id === dragT.id)?.due === day3, 3000), dragT.title);

// 패널에서 수정
const pEdit = (await getTodos()).find((t) => !t.done && t.site === 'mail.naver.com' && t.due);
await panel.click(`.sp-item[data-id="${pEdit.id}"] .title`);
await panel.fill('#fTitle', '정산 서류 제출');
await panel.click('#editForm button[type="submit"]');
check('사이드 패널: 할 일 수정', await waitFor(async () => (await getTodos()).find((t) => t.id === pEdit.id)?.title === '정산 서류 제출', 3000));

// 패널에서 완료
await panel.click(`.sp-item[data-id="${pEdit.id}"] .chk`);
check('사이드 패널: 완료 체크', await waitFor(async () => (await getTodos()).find((t) => t.id === pEdit.id)?.done, 3000));

// 메일함 탭으로 옮기면 패널 위쪽에 그 메일함이 보임
check('사이드 패널: 메일함 탭이 아닐 때 안내', (await panel.textContent('#siteName')).includes('메일함 탭이 아니에요'));
await gw.bringToFront();
check('사이드 패널: 사내 메일 탭으로 옮기면 그 메일함 표시', await waitFor(async () => (await panel.textContent('#siteName')) === '우리회사' && (await panel.textContent('#siteState')) === '수집 중', 4000), await panel.textContent('#siteName'));
await gm.bringToFront();
check('사이드 패널: 구글 탭으로 옮기면 바뀜', await waitFor(async () => (await panel.textContent('#siteName')) === '구글', 4000), await panel.textContent('#siteName'));

// 끄기 → 켜기
await wm.bringToFront();
await waitFor(async () => (await panel.textContent('#siteHelp')).includes('localhost'), 4000);
await panel.click('#toggleSite');
check('사이드 패널: 끄기', await waitFor(async () => !(await dash.evaluate(async () => (await chrome.storage.local.get('sites')).sites)).includes('localhost'), 3000));
await waitFor(async () => (await panel.textContent('#toggleSite')).includes('켜기'), 3000);
await panel.click('#toggleSite');
check('사이드 패널: 다시 켜기', await waitFor(async () => (await dash.evaluate(async () => (await chrome.storage.local.get('sites')).sites)).includes('localhost'), 3000));
await panel.screenshot({ path: path.join(OUT, '6-sidepanel-site.png') });

const badge = await sw.evaluate(() => chrome.action.getBadgeText({}));
check('배지: 오늘까지 할 일 수 표시', /^\d+$/.test(badge), badge);

check('페이지 오류 없음', errors.length === 0, errors.join(' / '));

await ctx.close();
server.close();
fs.writeFileSync(path.join(OUT, 'results.txt'), results.join('\n') + '\n');
console.log(results.join('\n'));
console.log(failed ? `\n실패 ${failed}개` : '\n모두 통과');
process.exit(failed ? 1 : 0);
