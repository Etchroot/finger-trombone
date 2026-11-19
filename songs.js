// 곡 데이터 — 모두 저작권이 끝난(퍼블릭 도메인) 멜로디예요.
// 표기: "음이름옥타브:박자"  ·  쉼표 "R:박자"  ·  슬라이드 "C4>G4:박자"  ·  "|" 는 보기 좋게 나눈 마디선(무시)

const STEP = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

function midi(name) {
  const m = /^([A-G])(#|b)?(\d)$/.exec(name);
  if (!m) throw new Error('음이름 오류: ' + name);
  return 12 * (Number(m[3]) + 1) + STEP[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
}

function parseMelody(text) {
  let beat = 0;
  const notes = [];
  for (const tok of text.trim().split(/\s+/)) {
    if (tok === '|') continue;
    const [pitch, lenText] = tok.split(':');
    const len = parseFloat(lenText);
    if (pitch !== 'R') {
      const [a, b] = pitch.split('>');
      notes.push({ start: beat, len, p0: midi(a), p1: midi(b || a) });
    }
    beat += len;
  }
  return notes;
}

// 마디마다 코드 하나, "G/C" 는 반 마디씩
function parseChords(text) {
  return text.trim().split(/\s+/).filter(t => t !== '|').map(t => {
    const [a, b] = t.split('/');
    return [a, b || a];
  });
}

function song(def) {
  const notes = parseMelody(def.melody);
  const pitches = notes.flatMap(n => [n.p0, n.p1]);
  const min = Math.min(...pitches), max = Math.max(...pitches);
  const pad = Math.max(2, Math.ceil((12 - (max - min)) / 2));
  return {
    ...def,
    notes,
    chords: parseChords(def.chords),
    lo: min - pad,
    hi: max + pad,
    lanes: [...new Set(pitches)].sort((a, b) => a - b),
  };
}

export const SONGS = [
  song({
    id: 'stairs',
    title: '도레미 계단',
    sub: '연습곡 · 슬라이드 익히기',
    level: 1,
    bpm: 84,
    melody: `C4:2 D4:2 | E4:2 F4:2 | G4:2 R:2 | G4>C4:3 R:1 | C4>G4:3 R:1 | G4:1 E4:1 C4:2`,
    chords: `C C C G C C`,
  }),
  song({
    id: 'twinkle',
    title: '작은 별',
    sub: '전래 동요',
    level: 1,
    bpm: 100,
    melody: `
      C4:1 C4:1 G4:1 G4:1 | A4:1 A4:1 G4:2 | F4:1 F4:1 E4:1 E4:1 | D4:1 D4:1 C4:2 |
      G4:1 G4:1 F4:1 F4:1 | E4:1 E4:1 D4:2 | G4:1 G4:1 F4:1 F4:1 | E4:1 E4:1 D4:2 |
      C4:1 C4:1 G4:1 G4:1 | A4:1 A4:1 G4:2 | F4:1 F4:1 E4:1 E4:1 | D4:1 D4:1 C4:1 C4>C5:1`,
    chords: `C F/C F/C G/C | C/F C/G C/F C/G | C F/C F/C G/C`,
  }),
  song({
    id: 'plane',
    title: '비행기',
    sub: '미국 동요 · Mary Had a Little Lamb',
    level: 1,
    bpm: 108,
    melody: `
      E4:1 D4:1 C4:1 D4:1 | E4:1 E4:1 E4:2 | D4:1 D4:1 D4:2 | E4:1 G4:1 G4:2 |
      E4:1 D4:1 C4:1 D4:1 | E4:1 E4:1 E4:1 E4:1 | D4:1 D4:1 E4:1 D4:1 | C4:2 C4>G4:2`,
    chords: `C C G C | C C G C`,
  }),
  song({
    id: 'bridge',
    title: '런던 다리',
    sub: '영국 전래 동요',
    level: 1,
    bpm: 112,
    melody: `
      G4:1.5 A4:.5 G4:1 F4:1 | E4:1 F4:1 G4:2 | D4:1 E4:1 F4:2 | E4:1 F4:1 G4:2 |
      G4:1.5 A4:.5 G4:1 F4:1 | E4:1 F4:1 G4:2 | D4:2 G4:2 | E4:1 C4:3`,
    chords: `C C G C | C C G C`,
  }),
  song({
    id: 'jacques',
    title: '자크 형제',
    sub: '프랑스 전래 동요 · Frère Jacques',
    level: 2,
    bpm: 104,
    melody: `
      C4:1 D4:1 E4:1 C4:1 | C4:1 D4:1 E4:1 C4:1 | E4:1 F4:1 G4:2 | E4:1 F4:1 G4:2 |
      G4:.5 A4:.5 G4:.5 F4:.5 E4:1 C4:1 | G4:.5 A4:.5 G4:.5 F4:.5 E4:1 C4:1 |
      C4:1 G3:1 C4:2 | C4:1 G3:1 C4:2`,
    chords: `C C C C | C C C C`,
  }),
  song({
    id: 'yankee',
    title: '양키 두들',
    sub: '미국 전래 민요',
    level: 2,
    bpm: 132,
    melody: `
      C4:1 C4:1 D4:1 E4:1 | C4:1 E4:1 D4:1 G3:1 | C4:1 C4:1 D4:1 E4:1 | C4:2 B3:2 |
      C4:1 C4:1 D4:1 E4:1 | F4:1 E4:1 D4:1 C4:1 | B3:1 G3:1 A3:1 B3:1 | C4:2 C4>G4:2`,
    chords: `C C/G C G | C F G C`,
  }),
  song({
    id: 'ode',
    title: '환희의 송가',
    sub: '베토벤 · 교향곡 9번',
    level: 2,
    bpm: 116,
    melody: `
      E4:1 E4:1 F4:1 G4:1 | G4:1 F4:1 E4:1 D4:1 | C4:1 C4:1 D4:1 E4:1 | E4:1.5 D4:.5 D4:2 |
      E4:1 E4:1 F4:1 G4:1 | G4:1 F4:1 E4:1 D4:1 | C4:1 C4:1 D4:1 E4:1 | D4:1.5 C4:.5 C4:2 |
      D4:1 D4:1 E4:1 C4:1 | D4:1 E4>F4:1 E4:1 C4:1 | D4:1 E4>F4:1 E4:1 D4:1 | C4:1 D4:1 G3:2 |
      E4:1 E4:1 F4:1 G4:1 | G4:1 F4:1 E4:1 D4:1 | C4:1 C4:1 D4:1 E4:1 | D4:1.5 C4:.5 C4:1 C4>G4:1`,
    chords: `C G C G | C G C G/C | G C G G | C G C G/C`,
  }),
  song({
    id: 'jingle',
    title: '징글벨',
    sub: '피어폰트 · 1857',
    level: 3,
    bpm: 138,
    melody: `
      E4:1 E4:1 E4:2 | E4:1 E4:1 E4:2 | E4:1 G4:1 C4:1.5 D4:.5 | E4:4 |
      F4:1 F4:1 F4:1.5 F4:.5 | F4:1 E4:1 E4:1 E4:.5 E4:.5 | E4:1 D4:1 D4:1 E4:1 | D4:2 G4:2 |
      E4:1 E4:1 E4:2 | E4:1 E4:1 E4:2 | E4:1 G4:1 C4:1.5 D4:.5 | E4:4 |
      F4:1 F4:1 F4:1.5 F4:.5 | F4:1 E4:1 E4:1 E4:.5 E4:.5 | G4:1 G4:1 F4:1 D4:1 | C4:2 C4>C5:2`,
    chords: `C C C C | F C G G | C C C C | F C G C`,
  }),
  song({
    id: 'susanna',
    title: '오! 수재너',
    sub: '포스터 · 1848',
    level: 3,
    bpm: 116,
    melody: `
      R:3 C4>D4:1 |
      E4:1 G4:1 G4:1.5 A4:.5 | G4:1 E4:1 C4:1.5 D4:.5 | E4:1 E4:1 D4:1 C4:1 | D4:3 C4>D4:1 |
      E4:1 G4:1 G4:1.5 A4:.5 | G4:1 E4:1 C4:1.5 D4:.5 | E4:1 E4:1 D4:1 D4:1 | C4:4 |
      F4:2 F4:2 | A4:1 A4:2 A4:1 | G4:1 G4:1 E4:1 C4:1 | D4:3 C4>D4:1 |
      E4:1 G4:1 G4:1.5 A4:.5 | G4:1 E4:1 C4:1.5 D4:.5 | E4:1 E4:1 D4:1 D4:1 | C4:2 C4>C5:2`,
    chords: `C | C C C G | C C C/G C | F F C G | C C C/G C`,
  }),
];
