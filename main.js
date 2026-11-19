// 손끝 트롬본 — MediaPipe Hand Landmarker + Web Audio 로 만든 리듬게임
// 손(엄지·검지 사이)의 높이 = 음 높이, 엄지+검지 꼬집기 = 불기
import { SONGS } from './songs.js?v=3';

const $ = s => document.querySelector(s);
const canvas = $('#stage');
const g = canvas.getContext('2d');
const video = $('#cam');
const el = {
  intro: $('#intro'), menu: $('#menu'), result: $('#result'),
  chip: $('#chip'), quit: $('#btnQuit'), songList: $('#songList'),
};

const AUTO = new URLSearchParams(location.search).has('auto'); // 자동 연주(시험용)
const SOLFEGE = ['도', '도#', '레', '레#', '미', '파', '파#', '솔', '솔#', '라', '라#', '시'];
const FONT = px => `400 ${px}px Jua, 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif`;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = t => t * t * (3 - 2 * t);
const hz = m => 440 * 2 ** ((m - 69) / 12);

let W = 0, H = 0;
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth; H = window.innerHeight;
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resize);
resize();

// ───────────────────────── 상태
let state = 'intro'; // intro | menu | playing | result
let game = null;
let lastSong = null;

const input = {
  y: H / 2, targetY: H / 2, toot: false,
  mouseY: H / 2, mouseDown: false, key: false,
  pinch: false, handAt: -1e9, handOn: false, lm: null,
  camOn: false, handError: false,
};

// 화면 배치: 판정선 x, 연주 영역 위/아래
const lineX = () => Math.max(90, W * 0.2);
const top = () => H * 0.16;
const bot = () => H * 0.84;
const range = () => (game ? game.song : { lo: 58, hi: 72 });
const yAt = p => { const r = range(); return top() + (r.hi - p) / (r.hi - r.lo) * (bot() - top()); };
const pitchAtY = y => { const r = range(); return r.hi - (y - top()) / (bot() - top()) * (r.hi - r.lo); };

// ───────────────────────── 손 인식 (MediaPipe · 전부 브라우저 안에서)
let landmarker = null;
let lastVideoTime = -1;

async function initHands() {
  try {
    const { FilesetResolver, HandLandmarker } = await import('./vendor/tasks-vision/vision_bundle.mjs');
    const fileset = await FilesetResolver.forVisionTasks(new URL('./vendor/tasks-vision/wasm', location.href).href);
    const make = delegate => HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: new URL('./vendor/hand_landmarker.task', location.href).href, delegate },
      runningMode: 'VIDEO',
      numHands: 1,
    });
    try { landmarker = await make('GPU'); } catch { landmarker = await make('CPU'); }
  } catch (err) {
    console.error('손 인식 준비 실패', err);
    input.handError = true;
  }
}

function cover() {
  const vw = video.videoWidth || 16, vh = video.videoHeight || 9;
  const s = Math.max(W / vw, H / vh);
  return { s, vw, vh, dx: (W - vw * s) / 2, dy: (H - vh * s) / 2 };
}
// 영상 좌표(0~1) → 거울처럼 뒤집은 화면 좌표
function toScreen(nx, ny) {
  const c = cover();
  return { x: W - (nx * c.vw * c.s + c.dx), y: ny * c.vh * c.s + c.dy };
}

function detectHands(now) {
  if (!landmarker || video.readyState < 2 || video.currentTime === lastVideoTime) return;
  lastVideoTime = video.currentTime;
  let res;
  try { res = landmarker.detectForVideo(video, now); } catch { return; }
  const lm = res.landmarks && res.landmarks[0];
  if (!lm) { input.lm = null; return; }
  input.lm = lm;
  input.handAt = now;
  const vw = video.videoWidth, vh = video.videoHeight;
  const dist = (a, b) => Math.hypot((lm[a].x - lm[b].x) * vw, (lm[a].y - lm[b].y) * vh);
  // 엄지 끝(4)–검지 끝(8) 거리를 손 크기(손목 0–중지 뿌리 9)로 나눠서 거리와 상관없이 판단
  const ratio = dist(4, 8) / Math.max(1, dist(0, 9));
  if (input.pinch) { if (ratio > 0.45) input.pinch = false; }
  else if (ratio < 0.28) input.pinch = true;
  input.targetY = toScreen(0, (lm[4].y + lm[8].y) / 2).y;
}

// ───────────────────────── 소리 (Web Audio)
let ac = null, master = null, voice = null, noiseBuf = null;

function initAudio() {
  if (ac) { ac.resume(); return; }
  ac = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
  const comp = ac.createDynamicsCompressor();
  master = ac.createGain();
  master.gain.value = 0.9;
  master.connect(comp); comp.connect(ac.destination);

  // 내 악기: 톱니파 + 사각파 → 로우패스 (금관 느낌) + 살짝 비브라토
  const o1 = ac.createOscillator(); o1.type = 'sawtooth';
  const o2 = ac.createOscillator(); o2.type = 'square'; o2.detune.value = 7;
  const g2 = ac.createGain(); g2.gain.value = 0.3;
  const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 700; f.Q.value = 2.5;
  const vg = ac.createGain(); vg.gain.value = 0;
  o1.connect(f); o2.connect(g2); g2.connect(f); f.connect(vg); vg.connect(master);
  const lfo = ac.createOscillator(); lfo.frequency.value = 5.5;
  const lg = ac.createGain(); lg.gain.value = 7;
  lfo.connect(lg); lg.connect(o1.detune); lg.connect(o2.detune);
  o1.start(); o2.start(); lfo.start();
  voice = { o1, o2, f, vg, on: false };

  noiseBuf = ac.createBuffer(1, ac.sampleRate * 0.5, ac.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
}

function setVoice(on, midi) {
  if (!ac) return;
  const t = ac.currentTime;
  const f = hz(midi - 12); // 한 옥타브 낮게 — 트롬본 음역
  voice.o1.frequency.setTargetAtTime(f, t, 0.012);
  voice.o2.frequency.setTargetAtTime(f, t, 0.012);
  if (on !== voice.on) {
    voice.on = on;
    voice.vg.gain.cancelScheduledValues(t);
    voice.vg.gain.setTargetAtTime(on ? 0.22 : 0, t, on ? 0.012 : 0.035);
    voice.f.frequency.cancelScheduledValues(t);
    voice.f.frequency.setTargetAtTime(on ? 2400 : 700, t, 0.06);
  }
}

function tone(t, midi, dur, type, vol, bus) {
  const o = ac.createOscillator(); o.type = type; o.frequency.value = hz(midi);
  const v = ac.createGain();
  v.gain.setValueAtTime(0.0001, t);
  v.gain.linearRampToValueAtTime(vol, t + 0.008);
  v.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(v); v.connect(bus);
  o.start(t); o.stop(t + dur + 0.03);
}
function noise(t, dur, vol, filterType, freq, bus) {
  const s = ac.createBufferSource(); s.buffer = noiseBuf;
  const f = ac.createBiquadFilter(); f.type = filterType; f.frequency.value = freq;
  const v = ac.createGain();
  v.gain.setValueAtTime(vol, t);
  v.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f); f.connect(v); v.connect(bus);
  s.start(t); s.stop(t + dur + 0.02);
}
function kick(t, bus) {
  const o = ac.createOscillator(); o.type = 'sine';
  o.frequency.setValueAtTime(150, t);
  o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
  const v = ac.createGain();
  v.gain.setValueAtTime(0.7, t);
  v.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
  o.connect(v); v.connect(bus);
  o.start(t); o.stop(t + 0.22);
}

const CHORD = {
  C: { root: 36, tones: [60, 64, 67] },
  F: { root: 41, tones: [60, 65, 69] },
  G: { root: 43, tones: [59, 62, 67] },
};

// 반주(쿵짝 리듬)를 박자 단위 사건 목록으로
function buildEvents(song) {
  const ev = [];
  for (let i = 0; i < 4; i++) ev.push({ b: -4 + i, k: 'click', accent: i === 0 });
  song.chords.forEach((pair, bar) => {
    for (let k = 0; k < 4; k++) {
      const ch = CHORD[pair[k < 2 ? 0 : 1]];
      const b = bar * 4 + k;
      ev.push({ b, k: k % 2 === 0 ? 'kick' : 'snare' });
      ev.push({ b, k: 'hat' }, { b: b + 0.5, k: 'hat' });
      if (k % 2 === 0) ev.push({ b, k: 'bass', m: k === 0 || pair[0] !== pair[1] ? ch.root : ch.root + 7 });
      ev.push({ b: b + 0.5, k: 'stab', ms: ch.tones });
    }
  });
  const end = song.chords.length * 4;
  ev.push({ b: end, k: 'kick' }, { b: end, k: 'bass', m: CHORD.C.root, long: true }, { b: end, k: 'stab', ms: CHORD.C.tones, long: true });
  return ev.sort((a, b) => a.b - b.b);
}

function playEvent(e, t, bus, spb) {
  switch (e.k) {
    case 'click': tone(t, e.accent ? 96 : 91, 0.06, 'square', 0.12, bus); break;
    case 'kick': kick(t, bus); break;
    case 'snare': noise(t, 0.12, 0.22, 'bandpass', 1800, bus); break;
    case 'hat': noise(t, 0.04, 0.07, 'highpass', 7000, bus); break;
    case 'bass': tone(t, e.m, e.long ? spb * 3 : spb * 0.9, 'triangle', 0.4, bus); break;
    case 'stab': for (const m of e.ms) tone(t, m, e.long ? spb * 3 : spb * 0.35, 'triangle', 0.07, bus); break;
  }
}

// 가까운 미래(0.25초)의 반주만 미리 예약
function pump() {
  const G = game;
  if (!G || !ac) return;
  const horizon = ac.currentTime + 0.25;
  while (G.ei < G.events.length) {
    const e = G.events[G.ei];
    const t = G.t0 + e.b * G.spb;
    if (t > horizon) break;
    playEvent(e, Math.max(t, ac.currentTime), G.bus, G.spb);
    G.ei++;
  }
}
setInterval(pump, 80);

// ───────────────────────── 게임
function startSong(song) {
  stopSong();
  initAudio();
  lastSong = song;
  const spb = 60 / song.bpm;
  const bus = ac.createGain();
  bus.gain.value = 0.75;
  bus.connect(master);
  const t0 = ac.currentTime + 0.3 + 4 * spb;
  const notes = song.notes.map(n => ({ ...n, got: 0, acc: 0, done: false }));
  const last = notes[notes.length - 1];
  game = {
    song, spb, bus, t0, notes,
    auto: AUTO,
    events: buildEvents(song), ei: 0,
    ni: 0, beat: -4, jb: (ac.currentTime - t0) / spb,
    endBeat: Math.max(last.start + last.len, song.chords.length * 4) + 2.5,
    totalLen: notes.reduce((s, n) => s + n.len, 0),
    accSum: 0, score: 0, combo: 0, maxCombo: 0,
    counts: { perfect: 0, good: 0, meh: 0, miss: 0 },
    breath: 1, winded: false, sounding: false,
    active: null, onTarget: 0,
    pops: [], parts: [],
  };
  show('playing');
}

function stopSong() {
  if (!game) return;
  const bus = game.bus;
  bus.gain.setTargetAtTime(0, ac.currentTime, 0.03);
  setTimeout(() => bus.disconnect(), 300);
  game = null;
}

// 숨: 계속 불면 BREATH_OUT 초에 바닥, 손가락을 떼면 BREATH_IN 초에 가득. 바닥나면 BREATH_BACK 만큼 찰 때까지 소리가 안 나요
const BREATH_OUT = 4, BREATH_IN = 0.5, BREATH_BACK = 0.4;

const JUDGE = {
  perfect: { text: '완벽!', color: '#ffd23f' },
  good: { text: '좋아요', color: '#3ef0c0' },
  meh: { text: '아슬아슬', color: '#b9b0d6' },
  miss: { text: '삑!', color: '#ff4f9a' },
};

function finalize(G, n) {
  const acc = clamp(n.got / (n.len * 0.9), 0, 1); // 음 앞뒤 10% 는 봐줘요
  n.acc = acc; n.done = true;
  const j = acc >= 0.85 ? 'perfect' : acc >= 0.55 ? 'good' : acc >= 0.25 ? 'meh' : 'miss';
  G.counts[j]++;
  if (j === 'perfect' || j === 'good') { G.combo++; G.maxCombo = Math.max(G.maxCombo, G.combo); }
  else G.combo = 0;
  G.accSum += acc * n.len;
  G.score += Math.round(acc * n.len * 100 * (1 + Math.min(G.combo, 20) * 0.05));
  G.pops.push({ ...JUDGE[j], age: 0, y: yAt(n.p1) });
  if (j === 'miss') buddy.sad = 0.8;
  if (j === 'perfect') buddy.happy = 0.4;
}

function updateGame(dt) {
  const G = game;
  pump();
  const beat = (ac.currentTime - G.t0) / G.spb;
  G.beat = beat;
  // 손 인식은 조금 늦게 따라오니까 판정 시각을 그만큼 늦춰요
  const jb = beat - (input.handOn ? 0.1 : 0.03) / G.spb;
  const db = Math.max(0, jb - G.jb);
  G.jb = jb;

  // 숨: 계속 불면 바닥나요 → 손가락을 떼면 금방 차요
  if (input.toot && !G.winded) {
    G.breath -= dt / BREATH_OUT;
    if (G.breath <= 0) { G.breath = 0; G.winded = true; }
  } else {
    G.breath = Math.min(1, G.breath + dt / BREATH_IN);
    if (G.winded && !input.toot && G.breath > BREATH_BACK) G.winded = false;
  }
  G.sounding = input.toot && !G.winded;

  G.active = null; G.onTarget = 0;
  const pitch = pitchAtY(input.y);
  while (G.ni < G.notes.length) {
    const n = G.notes[G.ni];
    if (jb >= n.start + n.len) { finalize(G, n); G.ni++; continue; }
    if (jb >= n.start) {
      const target = n.p0 + (n.p1 - n.p0) * smooth((jb - n.start) / n.len);
      const diff = Math.abs(pitch - target);
      const credit = !G.sounding ? 0 : diff <= 1.1 ? 1 : diff <= 2.2 ? 0.5 : 0;
      n.got += db * credit;
      G.active = n; G.onTarget = credit;
      if (credit === 1) {
        G.parts.push({
          x: lineX(), y: input.y, vx: 60 + Math.random() * 160, vy: (Math.random() - 0.5) * 220,
          life: 0.5, hue: 40 + Math.random() * 30,
        });
      }
    }
    break;
  }
  if (beat >= G.endBeat) finish();
}

const GRADES = [
  [0.92, 'S', '전설의 손끝! 🎉'],
  [0.8, 'A', '멋진 연주였어요 👏'],
  [0.62, 'B', '꽤 잘 불었어요!'],
  [0.4, 'C', '조금만 더 하면 돼요'],
  [0, 'D', '삑사리도 음악이에요 😆'],
];

function finish() {
  const G = game;
  const acc = G.accSum / G.totalLen;
  const [, grade, msg] = GRADES.find(r => acc >= r[0]);
  const best = loadBest(G.song.id);
  const isBest = !G.auto && (!best || G.score > best.score);
  if (isBest) saveBest(G.song.id, { score: G.score, grade });
  $('#rSong').textContent = G.song.title + (isBest && best ? ' · 최고 기록 갱신!' : '');
  $('#rGrade').textContent = grade;
  $('#rMsg').textContent = msg;
  $('#rScore').textContent = G.score.toLocaleString();
  $('#rAcc').textContent = Math.round(acc * 100) + '%';
  $('#rCombo').textContent = G.maxCombo;
  $('#rJudges').innerHTML = Object.entries(JUDGE)
    .map(([k, v]) => `<span>${v.text} <b>${G.counts[k]}</b></span>`).join('');
  stopSong();
  show('result');
}

function loadBest(id) {
  try { return JSON.parse(localStorage.getItem('ft-best-' + id)); } catch { return null; }
}
function saveBest(id, v) {
  try { localStorage.setItem('ft-best-' + id, JSON.stringify(v)); } catch { /* 저장 못 해도 게임은 계속 */ }
}

// ───────────────────────── 화면 전환 · 버튼
function show(next) {
  state = next;
  el.intro.hidden = next !== 'intro';
  el.menu.hidden = next !== 'menu';
  el.result.hidden = next !== 'result';
  el.quit.hidden = next !== 'playing';
  el.chip.hidden = next === 'intro';
  if (next === 'menu') renderSongs();
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
}

function renderSongs() {
  el.songList.replaceChildren(...SONGS.map(song => {
    const b = document.createElement('button');
    b.className = 'song';
    const best = loadBest(song.id);
    b.innerHTML = `<span class="t">${song.title}</span><span class="lv">${'★'.repeat(song.level)}${'☆'.repeat(3 - song.level)}</span>
      <span class="s">${song.sub} · ${song.bpm} BPM</span><span class="best">${best ? `최고 ${best.grade} · ${best.score.toLocaleString()}` : ''}</span>`;
    b.addEventListener('click', () => startSong(song));
    return b;
  }));
}

$('#btnCam').addEventListener('click', async () => {
  initAudio();
  show('menu');
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
    input.camOn = true;
    initHands();
  } catch (err) {
    console.warn('카메라를 켤 수 없어요', err);
    input.handError = true;
    $('#menuHint').textContent = '카메라를 켤 수 없어서 마우스로 해요 — 클릭하거나 Space 로 불어요 🖱';
  }
});
$('#btnMouse').addEventListener('click', () => {
  initAudio();
  $('#menuHint').textContent = '마우스를 위아래로 움직이고, 클릭하거나 Space 로 불어 보세요 🖱';
  show('menu');
});
$('#btnRetry').addEventListener('click', () => startSong(lastSong));
$('#btnMenu').addEventListener('click', () => show('menu'));
$('#btnShare').addEventListener('click', async e => {
  const url = location.origin + location.pathname;
  try { await navigator.clipboard.writeText(url); e.target.textContent = '복사했어요!'; }
  catch { e.target.textContent = url; }
});
const quit = () => { if (state === 'playing') { stopSong(); show('menu'); } };
el.quit.addEventListener('click', quit);

window.addEventListener('pointermove', e => { input.mouseY = e.clientY; });
canvas.addEventListener('pointerdown', e => { input.mouseDown = true; input.mouseY = e.clientY; });
window.addEventListener('pointerup', () => { input.mouseDown = false; });
window.addEventListener('pointercancel', () => { input.mouseDown = false; });
window.addEventListener('keydown', e => {
  if (e.code === 'Space') { input.key = true; if (state === 'playing') e.preventDefault(); }
  if (e.code === 'Escape') quit();
});
window.addEventListener('keyup', e => { if (e.code === 'Space') input.key = false; });
window.addEventListener('blur', () => { input.key = false; input.mouseDown = false; });
document.addEventListener('visibilitychange', () => { if (document.hidden) quit(); });
window.addEventListener('pagehide', () => {
  const s = video.srcObject;
  if (s) s.getTracks().forEach(t => t.stop()); // 떠날 때 카메라 끄기
});

// ───────────────────────── 매 프레임
function updateInput(now, dt) {
  input.handOn = now - input.handAt < 350;
  let ty = input.handOn ? input.targetY : input.mouseY;
  let toot = input.handOn ? (input.pinch || input.key) : (input.mouseDown || input.key);
  let speed = input.handOn ? 28 : 60;

  if (game && game.auto) { // 자동 연주: 다음 음을 그대로 따라가요
    const jb = (ac.currentTime - game.t0) / game.spb - 0.03 / game.spb;
    const n = game.notes.find(m => jb < m.start + m.len);
    if (n) {
      const prog = clamp((jb - n.start) / n.len, 0, 1);
      ty = yAt(n.p0 + (n.p1 - n.p0) * smooth(prog));
      toot = jb >= n.start - 0.05 && prog < 0.88; // 음 끝에서 숨 쉬기
      speed = 200;
    } else toot = false;
  }
  input.y += (clamp(ty, top(), bot()) - input.y) * (1 - Math.exp(-dt * speed));
  input.toot = toot;

  const sounding = state === 'playing' ? toot && !game.winded : state === 'menu' && toot;
  setVoice(sounding, pitchAtY(input.y));

  const chip = !input.camOn ? (input.handError ? '⚠ 카메라 없음 · 마우스 모드' : '🖱 마우스 모드')
    : input.handError ? '⚠ 손 인식 실패 · 마우스 모드'
    : !landmarker ? '🧠 손 인식 준비 중…'
    : input.handOn ? (input.pinch ? '🤏 불고 있어요' : '✋ 손 인식 중') : '👀 손을 카메라에 보여 주세요';
  if (el.chip.textContent !== chip) el.chip.textContent = chip;
}

const HAND_LINES = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]];

function drawBackground() {
  if (input.camOn && video.readyState >= 2) {
    const c = cover();
    g.save();
    g.translate(W, 0); g.scale(-1, 1);
    g.drawImage(video, c.dx, c.dy, c.vw * c.s, c.vh * c.s);
    g.restore();
    g.fillStyle = 'rgba(18, 11, 46, 0.6)';
    g.fillRect(0, 0, W, H);
  } else {
    const bg = g.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#1b1046'); bg.addColorStop(1, '#3a0f4f');
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);
  }
}

function drawHand() {
  if (!input.handOn || !input.lm) return;
  const pts = input.lm.map(p => toScreen(p.x, p.y));
  g.lineWidth = 3; g.lineCap = 'round';
  g.strokeStyle = 'rgba(62, 240, 192, 0.55)';
  g.beginPath();
  for (const [a, b] of HAND_LINES) { g.moveTo(pts[a].x, pts[a].y); g.lineTo(pts[b].x, pts[b].y); }
  g.stroke();
  for (const i of [4, 8]) {
    g.fillStyle = input.pinch ? '#ffd23f' : '#fff8e7';
    g.beginPath(); g.arc(pts[i].x, pts[i].y, input.pinch ? 9 : 6, 0, Math.PI * 2); g.fill();
  }
  // 손에서 판정선의 커서까지 점선
  const mx = (pts[4].x + pts[8].x) / 2;
  g.setLineDash([4, 8]); g.lineWidth = 2; g.strokeStyle = 'rgba(255, 248, 231, 0.35)';
  g.beginPath(); g.moveTo(mx, input.y); g.lineTo(lineX(), input.y); g.stroke();
  g.setLineDash([]);
}

function drawCursor(now) {
  const x = lineX(), y = input.y;
  const on = state === 'playing' ? game.sounding : input.toot;
  const hit = state === 'playing' && game.onTarget === 1;
  g.save();
  if (on) {
    g.shadowColor = hit ? '#ffd23f' : '#ff4f9a'; g.shadowBlur = 28;
    g.fillStyle = hit ? '#ffd23f' : '#ff4f9a';
    g.beginPath(); g.arc(x, y, 17 + Math.sin(now / 45) * 2.5, 0, Math.PI * 2); g.fill();
  }
  g.shadowBlur = 0;
  g.lineWidth = 4; g.strokeStyle = '#fff8e7';
  g.beginPath(); g.arc(x, y, on ? 17 : 13, 0, Math.PI * 2); g.stroke();
  g.restore();
  if (state === 'menu') {
    const p = Math.round(pitchAtY(y));
    g.font = FONT(18); g.textAlign = 'right'; g.textBaseline = 'middle';
    g.fillStyle = 'rgba(255, 248, 231, 0.8)';
    g.fillText(SOLFEGE[((p % 12) + 12) % 12], x - 26, y);
  }
}

function drawNote(G, n, ppb) {
  const lx = lineX(), R = 12;
  const x0 = lx + (n.start - G.beat) * ppb + R;
  const x1 = Math.max(x0, lx + (n.start + n.len - G.beat) * ppb - R - Math.min(8, n.len * ppb * 0.12));
  if (x1 < -40 || x0 > W + 40) return;
  const y0 = yAt(n.p0), y1 = yAt(n.p1);
  g.beginPath();
  g.moveTo(x0, y0);
  if (y0 === y1) g.lineTo(x1, y1);
  else for (let i = 1; i <= 20; i++) g.lineTo(x0 + (x1 - x0) * i / 20, y0 + (y1 - y0) * smooth(i / 20));

  const active = G.active === n;
  let color, alpha = 1, glow = 0;
  if (n.done) { color = n.acc >= 0.55 ? '#3ef0c0' : '#6b6190'; alpha = 0.45; }
  else if (active && G.onTarget === 1) { color = '#ffd23f'; glow = 26; }
  else if (active && G.onTarget > 0) { color = '#ffa23f'; glow = 10; }
  else { color = n.p0 === n.p1 ? '#ff4f9a' : '#b46bff'; }
  g.save();
  g.globalAlpha = alpha;
  g.lineCap = 'round'; g.lineJoin = 'round';
  g.shadowColor = color; g.shadowBlur = glow;
  g.lineWidth = R * 2; g.strokeStyle = color; g.stroke();
  g.shadowBlur = 0;
  g.lineWidth = 5; g.strokeStyle = 'rgba(255, 255, 255, 0.4)'; g.stroke();
  g.restore();
}

function drawPlayfield(dt) {
  const G = game, lx = lineX(), t = top(), b = bot();
  const ppb = Math.max(180, W * 0.22) * G.spb;

  // 음 높이 안내선
  g.font = FONT(15); g.textAlign = 'left'; g.textBaseline = 'middle';
  for (const p of G.song.lanes) {
    const y = yAt(p);
    g.strokeStyle = 'rgba(255, 248, 231, 0.13)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(lx, y); g.lineTo(W, y); g.stroke();
    g.fillStyle = 'rgba(255, 248, 231, 0.55)';
    g.fillText(SOLFEGE[p % 12], 12, y);
  }
  // 판정선
  g.strokeStyle = 'rgba(255, 248, 231, 0.7)'; g.lineWidth = 3;
  g.beginPath(); g.moveTo(lx, t - 24); g.lineTo(lx, b + 24); g.stroke();

  for (const n of G.notes) drawNote(G, n, ppb);

  // 숨 게이지
  const bx = lx - 44, bh = b - t;
  g.fillStyle = 'rgba(0, 0, 0, 0.35)'; g.fillRect(bx, t, 8, bh);
  g.fillStyle = G.winded ? '#ff4f9a' : G.breath < 0.3 ? '#ffa23f' : '#3ef0c0';
  g.fillRect(bx, t + bh * (1 - G.breath), 8, bh * G.breath);
  g.font = FONT(13); g.textAlign = 'center'; g.fillStyle = 'rgba(255, 248, 231, 0.7)';
  g.fillText('숨', bx + 4, b + 16);

  // 반짝이
  G.parts = G.parts.filter(p => (p.life -= dt) > 0);
  for (const p of G.parts) {
    p.x += p.vx * dt; p.y += p.vy * dt;
    g.fillStyle = `hsla(${p.hue}, 100%, 65%, ${p.life * 2})`;
    g.beginPath(); g.arc(p.x, p.y, 3 + p.life * 5, 0, Math.PI * 2); g.fill();
  }
  // 판정 글자
  G.pops = G.pops.filter(p => (p.age += dt) < 0.8);
  g.textAlign = 'left';
  for (const p of G.pops) {
    g.globalAlpha = 1 - p.age / 0.8;
    g.font = FONT(26); g.fillStyle = p.color;
    g.fillText(p.text, lx + 28, p.y - 30 - p.age * 40);
  }
  g.globalAlpha = 1;

  // 위쪽 정보
  g.fillStyle = 'rgba(255, 210, 63, 0.9)';
  g.fillRect(0, 0, W * clamp(G.beat / G.endBeat, 0, 1), 5);
  g.textAlign = 'left'; g.textBaseline = 'top';
  g.font = FONT(18); g.fillStyle = 'rgba(255, 248, 231, 0.75)';
  g.fillText('🎵 ' + G.song.title + (G.auto ? ' (자동 연주)' : ''), 14, 16);
  g.textAlign = 'center';
  g.font = FONT(40); g.fillStyle = '#fff8e7';
  g.fillText(G.score.toLocaleString(), W / 2, 14);
  if (G.combo >= 2) {
    g.font = FONT(22); g.fillStyle = '#ffd23f';
    g.fillText(G.combo + ' 콤보!', W / 2, 60);
  }
  g.textBaseline = 'middle';

  // 가운데 안내: 카운트다운 · 숨참 · 손 없음
  let big = '', small = '';
  if (G.beat < 0) big = String(Math.ceil(-G.beat));
  else if (G.winded) small = '😮‍💨 숨이 차요! 손가락을 잠깐 떼요';
  else if (input.camOn && landmarker && !input.handOn && !G.auto) small = '✋ 손을 카메라에 보여 주세요';
  if (big) {
    const frac = -G.beat - Math.floor(-G.beat);
    g.font = FONT(120 + frac * 40); g.fillStyle = `rgba(255, 210, 63, ${0.35 + frac * 0.65})`;
    g.fillText(big, W / 2, H / 2);
  }
  if (small) {
    g.font = FONT(24); g.fillStyle = '#fff8e7';
    g.fillText(small, W / 2, b + 44);
  }
}

// ───────────────────────── 나팔이 (오른쪽 위에서 같이 연주하는 친구)
// 박자에 맞춰 들썩이고, 불면 볼이 부풀고, 손 높이에 따라 슬라이드가 늘었다 줄어요
const buddy = { puff: 0, sad: 0, happy: 0, notes: [], emit: 0 };
const INK = '#2a1a5e';

function drawBuddy(now, dt) {
  const playing = state === 'playing';
  const beat = playing ? game.beat : now / 500;
  const on = playing ? game.sounding : state === 'menu' && input.toot;
  const winded = playing && game.winded;
  const cool = playing && game.combo >= 8;
  const hit = playing && game.onTarget === 1;
  const r = range();
  const pn = clamp((pitchAtY(input.y) - r.lo) / (r.hi - r.lo), 0, 1);
  const pulse = Math.exp(-(beat - Math.floor(beat)) * 5);
  buddy.puff += ((on ? 1 : 0) - buddy.puff) * (1 - Math.exp(-dt * 18));
  buddy.sad = Math.max(0, buddy.sad - dt);
  buddy.happy = Math.max(0, buddy.happy - dt);
  const puff = buddy.puff;
  const s = clamp(Math.min(W, H) / 720, 0.5, 1.25);
  const jump = Math.sin(clamp(buddy.happy / 0.4, 0, 1) * Math.PI) * 14;
  const bodyColor = winded ? '#9db4ff' : '#ffd23f';

  const line = (...p) => { g.beginPath(); g.moveTo(p[0], p[1]); for (let i = 2; i < p.length; i += 2) g.lineTo(p[i], p[i + 1]); g.stroke(); };
  const blob = (x, y, rx, ry, fill, lw = 4) => {
    g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    g.fillStyle = fill; g.fill();
    if (lw) { g.lineWidth = lw; g.strokeStyle = INK; g.stroke(); }
  };
  const pipe = (...p) => { // 금색 관: 어두운 테두리 위에 금색
    g.lineWidth = 10; g.strokeStyle = INK; line(...p);
    g.lineWidth = 5; g.strokeStyle = '#ffb703'; line(...p);
  };

  g.save();
  g.translate(W - 100 * s, 62 + 96 * s - jump * s);
  g.scale(s, s);
  g.lineCap = 'round'; g.lineJoin = 'round';
  g.rotate(Math.sin(beat * Math.PI) * 0.07 + puff * 0.07);

  // 다리 — 왼발로 박자 맞추기
  const tap = Math.floor(beat) % 2 === 0 ? pulse * 8 : 0;
  g.lineWidth = 7; g.strokeStyle = INK;
  line(-18, 56, -22, 82 - tap); line(18, 56, 22, 82);
  blob(-29, 85 - tap, 13, 6, '#ff4f9a', 3);
  blob(27, 85, 13, 6, '#ff4f9a', 3);

  // 몸통 — 박자마다 살짝 눌렸다 펴져요
  g.save();
  g.translate(0, 70); g.scale(1 + pulse * 0.05 + puff * 0.04, 1 - pulse * 0.06); g.translate(0, -70);
  blob(0, 0, 58, 64, bodyColor);
  blob(6, 26, 30, 24, 'rgba(255, 255, 255, 0.28)', 0);
  // 나비넥타이
  g.fillStyle = '#ff4f9a'; g.strokeStyle = INK; g.lineWidth = 3;
  g.beginPath(); g.moveTo(-8, 40); g.lineTo(-24, 31); g.lineTo(-24, 49); g.closePath(); g.fill(); g.stroke();
  g.beginPath(); g.moveTo(-8, 40); g.lineTo(8, 31); g.lineTo(8, 49); g.closePath(); g.fill(); g.stroke();

  // 볼
  blob(-40, 6, 8 + puff * 10, 8 + puff * 9, '#ff7aa8', 0);
  blob(24, 8, 7 + puff * 5, 7 + puff * 4, '#ff7aa8', 0);

  // 눈
  const eyes = [[-24, -22], [10, -24]];
  if (cool) { // 콤보가 이어지면 선글라스
    g.fillStyle = INK;
    g.beginPath(); g.roundRect(-42, -34, 32, 22, 8); g.roundRect(-6, -36, 32, 22, 8); g.fill();
    g.lineWidth = 4; g.strokeStyle = INK; line(-10, -26, -6, -27); line(26, -28, 44, -34);
    g.lineWidth = 3; g.strokeStyle = 'rgba(255, 255, 255, 0.7)'; line(-36, -28, -30, -22); line(0, -30, 6, -24);
  } else if (winded) {
    g.lineWidth = 4; g.strokeStyle = INK;
    for (const [x, y] of eyes) { line(x - 7, y - 7, x + 7, y + 7); line(x + 7, y - 7, x - 7, y + 7); }
  } else if (puff > 0.5) { // 힘줘서 부는 눈 > <
    g.lineWidth = 4; g.strokeStyle = INK;
    line(-32, -29, -20, -22, -32, -15); line(18, -31, 6, -24, 18, -17);
  } else {
    for (const [x, y] of eyes) {
      blob(x, y, 13, 13, '#fff', 3);
      const pr = buddy.sad > 0 ? 3.5 : 6;
      blob(x - 4, y + (0.5 - pn) * 8, pr, pr, INK, 0);
    }
    if (buddy.sad > 0) { g.lineWidth = 4; g.strokeStyle = INK; line(-38, -38, -16, -44); line(-2, -46, 22, -40); }
  }
  // 땀 한 방울 (틀렸거나 숨찰 때)
  if (buddy.sad > 0 || winded) {
    g.fillStyle = '#7fd8ff'; g.strokeStyle = INK; g.lineWidth = 2;
    g.beginPath(); g.moveTo(42, -50); g.quadraticCurveTo(52, -34, 42, -32); g.quadraticCurveTo(32, -34, 42, -50); g.fill(); g.stroke();
  }
  g.restore();

  // 모자 — 박자마다 통통 튀어요
  g.save();
  g.translate(4, -60 - pulse * 10 - jump * 0.6); g.rotate(0.14);
  g.fillStyle = '#ff4f9a'; g.strokeStyle = INK; g.lineWidth = 3;
  g.beginPath(); g.roundRect(-15, -26, 30, 26, 4); g.fill(); g.stroke();
  g.fillStyle = '#ffd23f'; g.fillRect(-15, -9, 30, 6);
  g.lineWidth = 7; line(-25, 0, 25, 0);
  g.restore();

  // 트롬본 — 손이 높을수록 위로 들리고 슬라이드가 짧아져요
  g.translate(-50, 8);
  g.rotate((pn - 0.4) * 0.6 + puff * 0.08);
  const L = 44 + (1 - pn) * 72;
  pipe(0, 0, 16, 0, 16, -15, -58, -15);          // 뒤쪽 관
  pipe(-12, 12, -18 - L, 12, -18 - L, 0, 0, 0);  // 슬라이드
  g.beginPath();                                  // 나팔
  g.moveTo(-56, -20); g.quadraticCurveTo(-78, -22, -94, -40);
  g.lineTo(-94, 10); g.quadraticCurveTo(-78, -8, -56, -10); g.closePath();
  g.fillStyle = '#ffb703'; g.fill(); g.lineWidth = 3.5; g.strokeStyle = INK; g.stroke();
  blob(-94, -15, 5, 25, '#e08a00', 3);
  // 팔 — 슬라이드를 따라 쭉쭉 늘어나요
  const hx = -18 - L * 0.75;
  g.lineWidth = 15; g.strokeStyle = INK; line(46, 34, hx, 14);
  g.lineWidth = 9; g.strokeStyle = bodyColor; line(46, 34, hx, 14);
  blob(hx, 13, 9, 9, bodyColor, 3);

  // 나팔 입구의 화면 좌표 (음표가 나오는 곳)
  const m = g.getTransform();
  const dpr = canvas.width / W;
  const bx = (m.a * -100 + m.c * -15 + m.e) / dpr, by = (m.b * -100 + m.d * -15 + m.f) / dpr;
  g.restore();

  // 불 때마다 음표가 튀어나와요
  buddy.emit -= dt;
  if (on && buddy.emit <= 0) {
    buddy.emit = 0.14;
    buddy.notes.push({
      x: bx, y: by, vx: -(70 + Math.random() * 90), vy: -(20 + Math.random() * 90) + (0.5 - pn) * 80,
      life: 1, ch: Math.random() < 0.5 ? '♪' : '♫', color: hit ? '#ffd23f' : playing ? '#ff4f9a' : '#3ef0c0',
      size: (18 + Math.random() * 12) * s,
    });
  }
  buddy.notes = buddy.notes.filter(n => (n.life -= dt * 1.1) > 0);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  for (const n of buddy.notes) {
    n.x += n.vx * dt; n.y += n.vy * dt; n.vy += 40 * dt;
    g.globalAlpha = Math.min(1, n.life * 1.6);
    g.font = FONT(n.size); g.fillStyle = n.color;
    g.fillText(n.ch, n.x, n.y);
  }
  g.globalAlpha = 1;
}

let prev = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - prev) / 1000);
  prev = now;
  detectHands(now);
  updateInput(now, dt);
  if (state === 'playing') updateGame(dt);
  drawBackground();
  if (state !== 'intro') drawBuddy(now, dt);
  if (state === 'playing') drawPlayfield(dt);
  drawHand();
  if (state === 'menu' || state === 'playing') drawCursor(now);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// 시험할 때 콘솔에서 들여다보는 용도
window.__ft = { get state() { return state; }, get game() { return game; }, input };
