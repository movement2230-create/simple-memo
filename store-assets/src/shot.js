'use strict';
// 스토어 스크린샷 장면을 그립니다. build_assets.py가 ?scene=main|search|fullview|promo 로 엽니다.
// 실제 popup.html을 iframe으로 띄우고, 미리 넣어 둔 예시 메모를 보여 줍니다.

const scene = new URLSearchParams(location.search).get('scene') || 'main';
const POPUP = '../../popup/popup.html';
const ICON = '../../icons/icon-128.png';

function seed() {
  const now = Date.now();
  const min = 60 * 1000;
  const day = 24 * 60 * min;
  const notes = [
    { id: 'n1', content: '주간 회의 메모\n\n- 디자인 리뷰: 목요일 오후 3시\n- 출시일을 다음 주 금요일로 확정\n- 각자 맡은 일 정리해서 수요일까지 공유\n- 다음 회의 안건: 사용자 의견 정리', createdAt: now - 3 * day, updatedAt: now - 2 * min },
    { id: 'n2', content: '장보기 목록\n우유, 계란, 사과, 두부, 대파, 커피 원두', createdAt: now - 2 * day, updatedAt: now - 40 * min },
    { id: 'n3', content: '여행 준비물\n여권, 충전기, 어댑터, 우산, 상비약', createdAt: now - 4 * day, updatedAt: now - 1 * day },
    { id: 'n4', content: '블로그 글 아이디어\n아침 루틴 한 달 해 본 후기\n주말 산책 코스 추천', createdAt: now - 6 * day, updatedAt: now - 2 * day },
    { id: 'n5', content: '회의 전에 확인할 것\n지난주 회의록, 일정표 최신본', createdAt: now - 9 * day, updatedAt: now - 5 * day },
  ];
  localStorage.setItem('memo-data', JSON.stringify({ notes, activeId: 'n1' }));
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  Object.assign(node, attrs);
  node.append(...children);
  return node;
}

function copyBlock(title, text) {
  const h1 = el('h1');
  h1.innerHTML = title; // 고정 문구만 사용
  return el('div', { className: 'copy' }, [
    el('div', { className: 'kicker' }, [el('img', { src: ICON, alt: '' }), '간단 메모장']),
    h1,
    el('p', { textContent: text }),
  ]);
}

function browserWindow(onPopupLoad) {
  const iframe = el('iframe', { className: 'popup', src: POPUP });
  iframe.addEventListener('load', () => onPopupLoad?.(iframe.contentDocument));
  return el('div', { className: 'window' }, [
    el('div', { className: 'tabstrip' }, [
      el('div', { className: 'dots' }, [el('i'), el('i'), el('i')]),
      el('div', { className: 'tab', textContent: '오늘의 뉴스 — example.com' }),
    ]),
    el('div', { className: 'toolbar' }, [
      el('div', { className: 'omnibox', textContent: 'news.example.com/today' }),
      el('div', { className: 'ext-icon' }, [el('img', { src: ICON, alt: '' })]),
    ]),
    el('div', { className: 'page' }, [
      el('div', { className: 'bar h' }),
      ...[100, 92, 96, 70, 0, 88, 94, 60].map((w) =>
        el('div', { className: 'bar', style: `width:${w}%;${w ? '' : 'visibility:hidden'}` })),
    ]),
    iframe,
  ]);
}

seed();
const stage = document.getElementById('stage');

if (scene === 'main') {
  stage.append(
    copyBlock('보던 페이지 그대로,<br>툴바에서 바로 메모', '아이콘을 누르면 메모장이 열리고, 입력하는 순간 저장됩니다. 창을 닫아도 내용은 그대로예요.'),
    browserWindow(),
  );
} else if (scene === 'search') {
  stage.append(
    copyBlock('쌓인 메모도<br>검색으로 바로 찾기', '모든 메모의 본문에서 단어를 찾아 줍니다. 필요한 메모는 .txt 파일로 내보낼 수도 있어요.'),
    browserWindow((doc) => {
      setTimeout(() => {
        const search = doc.getElementById('search');
        search.value = '회의';
        search.dispatchEvent(new Event('input'));
        search.focus();
      }, 100);
    }),
  );
} else if (scene === 'fullview') {
  stage.append(el('iframe', { className: 'fullview', src: `${POPUP}?view=tab` }));
} else if (scene === 'promo') {
  document.body.classList.add('promo');
  stage.append(el('div', { className: 'promo-inner' }, [
    el('img', { src: ICON, alt: '' }),
    el('h1', { textContent: '간단 메모장' }),
    el('p', { textContent: '툴바에서 바로 쓰고, 자동으로 저장되는 메모' }),
  ]));
}
