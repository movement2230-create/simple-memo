// 실행: node --test mail-todo/tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSubject, parseDue, parseTime, cleanTitle, ymd, subjectKey } from '../src/rules.js';

// 기준일: 2026-11-19 (목요일)
const BASE = new Date(2026, 10, 19, 9, 0);
const due = (s) => {
  const d = parseDue(s, BASE);
  return d ? ymd(d) : null;
};

test('제목 앞의 RE:/FW:/[외부] 정리', () => {
  assert.equal(cleanTitle('RE: FW: [외부] 견적서 검토 요청'), '견적서 검토 요청');
  assert.equal(cleanTitle('회신: 전달: 주간 보고'), '주간 보고');
  assert.equal(cleanTitle('Re[2]: Budget review'), 'Budget review');
});

test('구체적인 날짜', () => {
  assert.equal(due('2026-12-03 계약서 제출'), '2026-12-03');
  assert.equal(due('2026년 12월 3일 워크숍'), '2026-12-03');
  assert.equal(due('11월 25일까지 회신 부탁드립니다'), '2026-11-25');
  assert.equal(due('견적서 11/25(화)까지 제출'), '2026-11-25');
  assert.equal(due('견적서 11.25(화) 마감'), '2026-11-25');
  assert.equal(due('25일까지 비용 정산'), '2026-11-25');
});

test('연말에 받은 내년 날짜는 내년으로', () => {
  const dec = new Date(2026, 11, 20);
  assert.equal(ymd(parseDue('1/5까지 제출', dec)), '2027-01-05');
});

test('숫자가 들어가도 날짜가 아닌 것', () => {
  assert.equal(due('버전 2.5 배포 안내'), null);
  assert.equal(due('3/4분기 실적 공유'), null);
  assert.equal(due('매출 12.5% 증가'), null);
});

test('상대 날짜', () => {
  assert.equal(due('오늘까지 회신 바랍니다'), '2026-11-19');
  assert.equal(due('금일 중 처리 요청'), '2026-11-19');
  assert.equal(due('내일 오전 회의'), '2026-11-20');
  assert.equal(due('모레까지 자료 준비'), '2026-11-21');
  assert.equal(due('D-3 행사 준비'), '2026-11-22');
  assert.equal(due('3일 이내 회신'), '2026-11-22');
  assert.equal(due('금요일까지 보고서 제출'), '2026-11-20');
  assert.equal(due('이번 주 화요일 회의록'), '2026-11-17');
  assert.equal(due('다음 주 수요일 워크숍 참석'), '2026-11-25');
  assert.equal(due('차주 중 검토 부탁드립니다'), '2026-11-27');
  assert.equal(due('이번 주 내 회신 요청'), '2026-11-20');
  assert.equal(due('이번 달 말까지 정산'), '2026-11-30');
  assert.equal(due('Please reply by Friday'), '2026-11-20');
  assert.equal(due('Need this by EOD'), '2026-11-19');
});

test('시간', () => {
  assert.equal(parseTime('내일 오후 3시 회의'), '15:00');
  assert.equal(parseTime('10시 반 미팅'), '10:30');
  assert.equal(parseTime('14시 30분까지'), '14:30');
  assert.equal(parseTime('15:00 고객 미팅'), '15:00');
  assert.equal(parseTime('24시간 점검 안내'), null);
  assert.equal(parseTime('시스템 점검'), null);
});

test('할 일로 판단', () => {
  const r = analyzeSubject('RE: [외부] 3분기 보고서 검토 요청 (11/25까지)', BASE);
  assert.equal(r.isTask, true);
  assert.equal(r.title, '3분기 보고서 검토 요청 (11/25까지)');
  assert.equal(r.due, '2026-11-25');
  assert.equal(r.priority, 'normal');
});

test('마감이 임박하거나 긴급하면 우선순위 높음', () => {
  assert.equal(analyzeSubject('내일까지 회신 부탁드립니다', BASE).priority, 'high');
  assert.equal(analyzeSubject('[긴급] 서버 장애 확인 요청', BASE).priority, 'high');
});

test('할 일이 아닌 것', () => {
  assert.equal(analyzeSubject('주간 뉴스레터 11월 3주차', BASE).isTask, false);
  assert.equal(analyzeSubject('(광고) 11/30까지 50% 할인', BASE).isTask, false);
  assert.equal(analyzeSubject('점심 메뉴 공유', BASE).isTask, false);
  assert.equal(analyzeSubject('Your receipt from Store', BASE).isTask, false);
  // "due"가 "reduce" 안에서 걸리면 안 됨
  assert.equal(analyzeSubject('How to reduce costs', BASE).isTask, false);
});

test('키워드 없이 날짜만 있어도 일정으로 등록', () => {
  const r = analyzeSubject('11/28 팀 워크숍 안내', BASE);
  assert.equal(r.isTask, true);
  assert.equal(r.due, '2026-11-28');
});

test('띄어쓰기가 달라도 키워드 인식', () => {
  assert.equal(analyzeSubject('자료 확인 부탁', BASE).isTask, true);
  assert.equal(analyzeSubject('자료확인부탁', BASE).isTask, true);
});

test('사용자 규칙 적용', () => {
  const rules = { taskKeywords: ['품의'], excludeKeywords: [], urgentKeywords: [] };
  assert.equal(analyzeSubject('품의서 올렸습니다', BASE, rules).isTask, true);
  assert.equal(analyzeSubject('검토 요청', BASE, rules).isTask, false);
});

test('같은 스레드는 같은 키', () => {
  assert.equal(subjectKey('mail.x.com', '견적 요청'), subjectKey('mail.x.com', 'RE: RE: 견적 요청'));
});
