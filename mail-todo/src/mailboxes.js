// 메일함(사이트)마다 이름과 색을 붙여 할 일을 구분합니다.
// 사용자가 설정에서 이름·색을 바꾸면 settings.mailboxes[host]에 저장됩니다.

const KNOWN = [
  [/^mail\.google\.com$/, '구글', '#4285f4'],
  [/^mail\.naver\.com$/, '네이버', '#03c75a'],
  [/^mail\.worksmobile\.com$/, '네이버웍스', '#00a0e9'],
  [/^outlook\.(office|office365|live)\.com$/, 'Outlook', '#0f6cbd'],
  [/^mail\.daum\.net$/, '다음', '#ff5a4a'],
];

// 알려지지 않은 메일함(대부분 사내 그룹웨어)에 차례로 쓰는 색
const PALETTE = ['#8e44ad', '#e67e22', '#16a085', '#c2185b', '#5d6d7e', '#b7950b'];

export const MANUAL = { key: '', name: '직접 추가', color: '#8a8a84' };

export function defaultMailbox(host, existing = {}) {
  for (const [re, name, color] of KNOWN) if (re.test(host)) return { name, color };
  const used = new Set(Object.values(existing).map((m) => m.color));
  const color = PALETTE.find((c) => !used.has(c)) || PALETTE[Object.keys(existing).length % PALETTE.length];
  return { name: '사내', color };
}

export function mailboxOf(site, mailboxes = {}) {
  if (!site) return MANUAL;
  return { key: site, ...defaultMailbox(site, mailboxes), ...(mailboxes[site] || {}) };
}

// 화면에 보여 줄 메일함 목록: 켠 사이트 + 할 일에 남아 있는 사이트 + 직접 추가
export function listMailboxes(sites, todos, mailboxes = {}) {
  const keys = [...new Set([...sites, ...todos.map((t) => t.site || '').filter(Boolean)])];
  const list = keys.map((k) => mailboxOf(k, mailboxes));
  if (todos.some((t) => !t.site)) list.push(MANUAL);
  return list;
}
