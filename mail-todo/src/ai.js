// 브라우저 내장 AI(Chrome: Gemini Nano, Edge: Phi-4-mini 등)로 할 일 문장과 마감일을 다듬습니다.
// 모델이 사용자 PC 안에서 돌아가므로 메일 제목이 외부로 나가지 않습니다.
// 내장 AI가 없는 브라우저에서는 아무 일도 하지 않습니다(규칙 기반 결과만 사용).

const SYSTEM = [
  '너는 회사 메일 제목만 보고 할 일을 정리하는 도우미다.',
  '받는 사람이 해야 할 행동(검토, 회신, 제출, 참석 등)이 있으면 isTask는 true, 단순 공유·안내·광고면 false.',
  'title은 해야 할 일을 40자 이내의 짧은 한국어로 쓴다. 예: "3분기 보고서 검토 후 회신".',
  'due는 제목에 마감일이나 일정 날짜가 있을 때만 오늘 날짜를 기준으로 YYYY-MM-DD 형식, 없으면 빈 문자열.',
  'priority는 긴급하거나 마감이 하루 이내면 high, 보통이면 normal, 참고용이면 low.',
  'JSON만 출력한다.',
].join('\n');

const SCHEMA = {
  type: 'object',
  properties: {
    isTask: { type: 'boolean' },
    title: { type: 'string' },
    due: { type: 'string' },
    priority: { type: 'string', enum: ['high', 'normal', 'low'] },
  },
  required: ['isTask', 'title', 'due', 'priority'],
};

// 'unsupported' | 'unavailable' | 'downloadable' | 'downloading' | 'available'
export async function aiAvailability() {
  if (!('LanguageModel' in self)) return 'unsupported';
  try {
    return await self.LanguageModel.availability();
  } catch {
    return 'unavailable';
  }
}

let base = null;

// 모델 내려받기는 버튼 클릭 같은 사용자 동작 안에서 호출해야 합니다.
export async function prepareModel(onProgress) {
  if (base) return base;
  base = await self.LanguageModel.create({
    initialPrompts: [{ role: 'system', content: SYSTEM }],
    monitor(m) {
      m.addEventListener('downloadprogress', (e) => onProgress?.(e.loaded));
    },
  });
  return base;
}

export async function refineSubject(subject, today) {
  const root = await prepareModel();
  const s = await root.clone(); // 메일마다 새 대화로(앞 메일 내용이 섞이지 않게)
  try {
    const out = await s.prompt(`오늘: ${today}\n메일 제목: ${subject}`, { responseConstraint: SCHEMA });
    const r = JSON.parse(out);
    return {
      isTask: r.isTask !== false,
      title: typeof r.title === 'string' ? r.title.trim().slice(0, 80) : '',
      due: /^\d{4}-\d{2}-\d{2}$/.test(r.due || '') ? r.due : null,
      priority: ['high', 'normal', 'low'].includes(r.priority) ? r.priority : 'normal',
    };
  } finally {
    s.destroy();
  }
}
