// 메일 제목 한 줄을 보고 "할 일인지", "마감일이 언제인지"를 판단하는 규칙 모음.
// 모든 판단은 이 파일 안의 코드로만 이뤄지며 외부로 아무것도 보내지 않습니다.
// 백그라운드, 달력 화면, 테스트(node --test)에서 함께 씁니다.

export const DEFAULT_RULES = {
  // 이 단어가 제목에 있으면 할 일로 봅니다. (띄어쓰기는 무시하고 비교)
  taskKeywords: [
    '요청', '부탁', '검토', '회신', '답변', '제출', '승인', '결재',
    '확인요청', '확인부탁', '확인바랍', '작성', '준비', '보고', '피드백', '의견',
    '참석', '회의', '미팅', '마감', '기한', '처리', '협조', '문의',
    'action required', 'request', 'review', 'approval', 'approve',
    'deadline', 'due', 'please', 'reply', 'rsvp', 'meeting',
  ],
  // 이 단어가 있으면 마감일이 있어도 할 일로 만들지 않습니다.
  excludeKeywords: [
    '(광고)', '[광고]', '뉴스레터', 'newsletter', 'unsubscribe', '수신거부',
    'no-reply', 'noreply', '영수증', 'receipt', '결제완료', '주문완료', '배송',
  ],
  // 이 단어가 있으면 우선순위를 '높음'으로 둡니다.
  urgentKeywords: ['긴급', '급함', '시급', '중요', 'asap', 'urgent', 'important'],
  // 이 보낸 사람(이름이나 메일 주소 일부)의 메일은 우선순위를 '높음'으로 둡니다. 예: 팀장 이름, boss@company.com
  vipSenders: [],
  // 이 보낸 사람의 메일은 할 일로 만들지 않습니다.
  excludeSenders: ['no-reply', 'noreply', 'donotreply', 'do-not-reply', 'mailer-daemon', 'notification', 'notifications'],
};

export const PRIORITIES = ['high', 'normal', 'low'];

// ---------- 날짜 도우미 (모두 사용자 PC의 현지 시간 기준) ----------

export function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function parseYmd(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}

export function addDays(base, n) {
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + n);
}

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function validDate(y, m, d) {
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d ? dt : null;
}

// 연도 없는 "11/25" 같은 날짜: 올해로 보되, 60일 넘게 지난 날짜면 내년으로 봅니다. (12월에 받은 "1/5까지")
function inferYear(base, m, d) {
  let dt = validDate(base.getFullYear(), m, d);
  if (!dt) return null;
  if ((startOfDay(base) - dt) / 86400000 > 60) dt = validDate(base.getFullYear() + 1, m, d) || dt;
  return dt;
}

const DOW_KO = { 일: 0, 월: 1, 화: 2, 수: 3, 목: 4, 금: 5, 토: 6 };
const DOW_EN = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

// 월요일을 한 주의 시작으로 보고, weekOffset 주 뒤의 dow 요일
function weekday(base, dow, weekOffset) {
  const d0 = base.getDay();
  const monday = addDays(base, d0 === 0 ? -6 : 1 - d0);
  return addDays(monday, (dow === 0 ? 6 : dow - 1) + 7 * weekOffset);
}

// 오늘 또는 그 이후로 가장 가까운 dow 요일
function nextWeekday(base, dow) {
  return addDays(base, (dow - base.getDay() + 7) % 7);
}

// ---------- 제목 정리 ----------

const TAG_RE = /\[(외부|외부메일|external|ext)\]\s*/gi;
const PREFIX_RE = /^\s*((re|fw|fwd|답장|회신|전달)\s*(\[\d+\])?\s*[:：]\s*)+/i;

export function cleanTitle(subject) {
  return String(subject || '')
    .replace(TAG_RE, '')
    .replace(PREFIX_RE, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------- 마감일 찾기 ----------

export function parseDue(text, base = new Date()) {
  const t = String(text || '');
  let m;

  // 2026-11-25, 2026.11.25, 2026/11/25, 2026년 11월 25일
  if ((m = t.match(/(20\d{2})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})/))) {
    const dt = validDate(+m[1], +m[2], +m[3]);
    if (dt) return dt;
  }
  // 11월 25일
  if ((m = t.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/))) {
    const dt = inferYear(base, +m[1], +m[2]);
    if (dt) return dt;
  }
  // 11/25 (단, "3/4분기" 같은 표현은 제외)
  if ((m = t.match(/(?<![\d./])(\d{1,2})\s*\/\s*(\d{1,2})(?![\d./%])(?!\s*분기)/))) {
    const dt = inferYear(base, +m[1], +m[2]);
    if (dt) return dt;
  }
  // 11.25 — "버전 2.5" 같은 숫자와 헷갈리지 않게 뒤에 요일·까지·마감이 올 때만
  if ((m = t.match(/(?<![\d./])(\d{1,2})\s*\.\s*(\d{1,2})(?![\d./%])\s*(?=\(?[월화수목금토일]\)|까지|마감|부터|일정)/))) {
    const dt = inferYear(base, +m[1], +m[2]);
    if (dt) return dt;
  }
  // 25일까지 / 25일 마감 → 이번 달 (일주일 넘게 지났으면 다음 달)
  if ((m = t.match(/(?<!\d)(\d{1,2})\s*일\s*(까지|마감|이전|자로)/))) {
    const d = +m[1];
    let dt = validDate(base.getFullYear(), base.getMonth() + 1, d);
    if (dt && dt < addDays(startOfDay(base), -7)) {
      const nm = new Date(base.getFullYear(), base.getMonth() + 1, 1);
      dt = validDate(nm.getFullYear(), nm.getMonth() + 1, d);
    }
    if (dt) return dt;
  }
  // D-3
  if ((m = t.match(/(?:^|[^a-z])d\s*-\s*(\d{1,3})(?!\d)/i))) return addDays(startOfDay(base), +m[1]);
  // 3일 이내
  if ((m = t.match(/(?<!\d)(\d{1,2})\s*일\s*(이내|내로|안에)/))) return addDays(startOfDay(base), +m[1]);
  // 다음 주 수요일 / 차주 수
  if ((m = t.match(/(다음\s*주|차주|내주|담주)\s*([월화수목금토일])(?:요일)?/))) return weekday(base, DOW_KO[m[2]], 1);
  // 이번 주 금요일 / 금주 금
  if ((m = t.match(/(이번\s*주|금주)\s*([월화수목금토일])(?:요일)?/))) return weekday(base, DOW_KO[m[2]], 0);
  // 금요일까지 → 가장 가까운 금요일
  if ((m = t.match(/([월화수목금토일])요일/))) return nextWeekday(base, DOW_KO[m[1]]);
  // 다음 주 중 / 차주 초
  if ((m = t.match(/(다음\s*주|차주|내주|담주)\s*(중|내|까지|말|초)/))) return weekday(base, m[2] === '초' ? 1 : 5, 1);
  // 이번 주 중 / 금주 내
  if ((m = t.match(/(이번\s*주|금주)\s*(중|내|까지|말)/))) return weekday(base, 5, 0);
  // 이번 달 말 / 월말
  if (/(이번\s*달|금월|이달)\s*(말|중|내|까지)|월말/.test(t)) return new Date(base.getFullYear(), base.getMonth() + 1, 0);
  if (/모레/.test(t)) return addDays(startOfDay(base), 2);
  if (/내일|익일/.test(t)) return addDays(startOfDay(base), 1);
  if (/오늘|금일|당일|즉시/.test(t)) return startOfDay(base);
  // 영어
  if (/\btomorrow\b/i.test(t)) return addDays(startOfDay(base), 1);
  if (/\b(today|eod|cob)\b/i.test(t)) return startOfDay(base);
  if ((m = t.match(/\bby\s+(sun|mon|tue|wed|thu|fri|sat)[a-z]*\b/i))) return nextWeekday(base, DOW_EN[m[1].toLowerCase()]);
  return null;
}

// 오후 3시 / 14시 30분 / 10시 반 / 15:00 → "15:00"
export function parseTime(text) {
  const t = String(text || '');
  let m = t.match(/(오전|오후|am|pm)?\s*(?<![\d:])(\d{1,2})\s*시(?!간|험|행|스템|작|즌)\s*(?:(\d{1,2})\s*분|(반))?/i);
  if (m) {
    let h = +m[2];
    const ap = (m[1] || '').toLowerCase();
    if ((ap === '오후' || ap === 'pm') && h < 12) h += 12;
    if ((ap === '오전' || ap === 'am') && h === 12) h = 0;
    const min = m[4] ? 30 : m[3] ? +m[3] : 0;
    if (h <= 23 && min <= 59) return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
  }
  m = t.match(/(?<![\d:])([01]?\d|2[0-3]):([0-5]\d)(?![\d:])/);
  if (m) return `${m[1].padStart(2, '0')}:${m[2]}`;
  return null;
}

// ---------- 종합 판단 ----------

const isAscii = (s) => /^[\x00-\x7f]+$/.test(s);
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function findKeywords(text, list) {
  const lower = String(text || '').toLowerCase();
  const compact = lower.replace(/\s+/g, '');
  return (list || []).filter((raw) => {
    const k = String(raw || '').trim().toLowerCase();
    if (!k) return false;
    // 영어 단어는 단어 경계로 비교 ("due"가 "reduce"에 걸리지 않게)
    if (isAscii(k) && /^[a-z]/.test(k)) return new RegExp(`\\b${escapeRe(k)}\\b`).test(lower);
    return compact.includes(k.replace(/\s+/g, ''));
  });
}

export function mergeRules(custom) {
  const r = { ...DEFAULT_RULES };
  for (const key of Object.keys(DEFAULT_RULES)) {
    if (Array.isArray(custom?.[key])) r[key] = custom[key];
  }
  return r;
}

export function analyzeSubject(subject, base = new Date(), rules = DEFAULT_RULES, sender = '') {
  const title = cleanTitle(subject);
  const taskHits = findKeywords(title, rules.taskKeywords);
  const excludeHits = [...findKeywords(title, rules.excludeKeywords), ...findKeywords(sender, rules.excludeSenders)];
  const urgentHits = [...findKeywords(title, rules.urgentKeywords), ...findKeywords(sender, rules.vipSenders)];
  const dueDate = parseDue(title, base);
  const dueTime = dueDate ? parseTime(title) : null;

  const isTask = excludeHits.length === 0 && (taskHits.length > 0 || !!dueDate);

  let priority = 'normal';
  if (urgentHits.length) priority = 'high';
  else if (dueDate && (dueDate - startOfDay(base)) / 86400000 <= 1) priority = 'high';

  return {
    isTask,
    title,
    due: dueDate ? ymd(dueDate) : null,
    dueTime,
    priority,
    hits: { task: taskHits, exclude: excludeHits, urgent: urgentHits },
  };
}

// 같은 메일 스레드(RE:, FW:)는 하나로 봅니다.
export function subjectKey(site, subject) {
  return `${site}|${cleanTitle(subject).toLowerCase()}`;
}

// 사이트 권한·content.js 등록에 쓰는 주소 패턴 (http/https, 모든 포트)
export const sitePattern = (host) => `*://${host}/*`;
