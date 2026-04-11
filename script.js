// ======================================================
// 나루토 결인 인술 시뮬레이터
// MediaPipe Holistic 기반 손 랜드마크 + 규칙 기반 감지
// ======================================================

const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const statusEl = document.getElementById("status");
const jutsuDisplay = document.getElementById("jutsu-name-display");

// ------------------------------------------------------
// 손가락 랜드마크 유틸
// ------------------------------------------------------
const FINGER_INDICES = {
  thumb:  [1, 2, 3, 4],
  index:  [5, 6, 7, 8],
  middle: [9, 10, 11, 12],
  ring:   [13, 14, 15, 16],
  pinky:  [17, 18, 19, 20],
};

function dist2D(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// 손가락이 펴져있는지: tip이 pip보다 wrist에서 더 멀면 펴진 상태
function isFingerExtended(lm, finger) {
  const [, pip, , tip] = FINGER_INDICES[finger].map(i => lm[i]);
  const wrist = lm[0];
  return dist2D(tip, wrist) > dist2D(pip, wrist) * 1.05;
}

function fingerStates(lm) {
  return {
    thumb:  isFingerExtended(lm, "thumb"),
    index:  isFingerExtended(lm, "index"),
    middle: isFingerExtended(lm, "middle"),
    ring:   isFingerExtended(lm, "ring"),
    pinky:  isFingerExtended(lm, "pinky"),
  };
}

function palmCenter(lm) {
  // 손바닥 중심 근사: wrist + middle MCP 평균
  return { x: (lm[0].x + lm[9].x) / 2, y: (lm[0].y + lm[9].y) / 2 };
}

// ------------------------------------------------------
// 결인(인술) 감지 규칙
// ------------------------------------------------------
function detectJutsu(right, left) {
  if (right && left) {
    const rs = fingerStates(right);
    const ls = fingerStates(left);
    const rc = palmCenter(right);
    const lc = palmCenter(left);
    const handGap = dist2D(rc, lc);

    // 호랑이 결인: 양손 붙이고 검지만 위로
    const tigerR = rs.index && !rs.middle && !rs.ring && !rs.pinky;
    const tigerL = ls.index && !ls.middle && !ls.ring && !ls.pinky;
    if (tigerR && tigerL && handGap < 0.2) {
      const rIndexUp = right[8].y < right[5].y;
      const lIndexUp = left[8].y < left[5].y;
      if (rIndexUp && lIndexUp) return "fireball";
    }

    // 분신술: 양손 ✌✌ 검지+중지를 십자가(+)로 교차
    const bunshinR = rs.index && rs.middle && !rs.ring && !rs.pinky;
    const bunshinL = ls.index && ls.middle && !ls.ring && !ls.pinky;
    if (bunshinR && bunshinL && handGap < 0.35) {
      // 각 손의 검지 방향 벡터 (MCP → tip)
      const rDir = { x: right[8].x - right[5].x, y: right[8].y - right[5].y };
      const lDir = { x: left[8].x - left[5].x, y: left[8].y - left[5].y };
      const rLen = Math.hypot(rDir.x, rDir.y);
      const lLen = Math.hypot(lDir.x, lDir.y);
      if (rLen > 0 && lLen > 0) {
        const dot = (rDir.x * lDir.x + rDir.y * lDir.y) / (rLen * lLen);
        // 두 검지가 수직에 가까울 때 (|내적| < 0.5 ≈ 60° 이상 교차)
        if (Math.abs(dot) < 0.5) return "bunshin";
      }
    }

    // 라센간: 양손 다 펴고, 한 손이 다른 손 위에 보조로 얹은 자세
    const openR = rs.index && rs.middle && rs.ring && rs.pinky;
    const openL = ls.index && ls.middle && ls.ring && ls.pinky;
    if (openR && openL) {
      const yDiff = Math.abs(rc.y - lc.y);
      const xDiff = Math.abs(rc.x - lc.x);
      // 세로로 겹침: y 차이 있고 x는 가까이
      if (yDiff > 0.08 && xDiff < 0.25) return "rasengan";
    }
  }

  // 치도리: 한 손만, 검지~소지 전부 펴고, 엄지는 접고, 손끝이 아래를 향하고, 화면 많이 아래쪽
  const only = (right && !left) ? right : (left && !right) ? left : null;
  if (only) {
    const s = fingerStates(only);
    const allOut = s.index && s.middle && s.ring && s.pinky;
    const thumbIn = !s.thumb;
    const pc = palmCenter(only);
    // 중지 끝이 중지 MCP보다 아래 → 손끝이 아래 방향
    const fingersPointDown = only[12].y > only[9].y;
    if (allOut && thumbIn && fingersPointDown && pc.y > 0.68) return "chidori";
  }

  return null;
}

// ------------------------------------------------------
// 상태
// ------------------------------------------------------
const JUTSU_INFO = {
  rasengan: { label: "螺旋丸 라센간",  color: "#5eb3ff" },
  chidori:  { label: "千鳥 치도리",    color: "#c9f2ff" },
  fireball: { label: "火遁 호화멸각",  color: "#ff8a2a" },
  bunshin:  { label: "影分身 분신술",  color: "#e4d4ff" },
};

// 이펙트 위치 캐싱 (손이 순간적으로 사라져도 이펙트 유지)
let lastRasenganPos = null;
let lastChidoriPos = null;

const HOLD_DURATION_MS = 600; // 0.6초 홀딩
const RESET_TOLERANCE = 10;   // null 또는 다른 제스처가 10프레임 연속이어야 리셋
const EFFECT_DURATION = 3000;
const COOLDOWN_MS = 500;

let currentDetecting = null;
let holdStartTime = null;
let badFrames = 0;
let activeEffect = null; // { type, start }
let lastActivationEnd = 0;

function activateJutsu(type) {
  const duration = type === "bunshin" ? BUNSHIN_EFFECT_DURATION : EFFECT_DURATION;
  activeEffect = { type, start: performance.now(), duration };
  lastRasenganPos = null;
  lastChidoriPos = null;
  resetBunshinClones();
  const info = JUTSU_INFO[type];
  jutsuDisplay.textContent = info.label;
  jutsuDisplay.style.color = info.color;
  jutsuDisplay.classList.add("show");
  statusEl.textContent = `${info.label} 발동!`;
  setTimeout(() => jutsuDisplay.classList.remove("show"), duration - 200);

  document.querySelectorAll(".jutsu-card").forEach(c => {
    c.classList.toggle("active", c.dataset.jutsu === type);
  });
  setTimeout(() => {
    document.querySelectorAll(".jutsu-card").forEach(c => c.classList.remove("active"));
  }, duration);
}

function updateUIProgress(detected, ratio) {
  document.querySelectorAll(".jutsu-card").forEach(c => {
    const isCharging = c.dataset.jutsu === detected;
    c.classList.toggle("charging", isCharging);
    const fill = c.querySelector(".jutsu-bar-fill");
    if (isCharging) {
      fill.style.width = Math.min(100, ratio * 100) + "%";
    } else {
      fill.style.width = "0%";
    }
  });
}

// ------------------------------------------------------
// 손동작 카드 이미지 프리로드
// ------------------------------------------------------
const ASSETS_PATH = "assets";

const state2Img = new Image(); // 분신술
state2Img.src = `${ASSETS_PATH}/state-2.png`;

const state3Img = new Image(); // 라센간
state3Img.src = `${ASSETS_PATH}/state-3.png`;

const state4Img = new Image(); // 호화멸각
state4Img.src = `${ASSETS_PATH}/state-4.png`;

const state5Img = new Image(); // 치도리
state5Img.src = `${ASSETS_PATH}/state-5.png`;

// 인술별 카드 이미지 매핑
const JUTSU_STATE_IMG = {
  bunshin:  state2Img,
  rasengan: state3Img,
  fireball: state4Img,
  chidori:  state5Img,
};

// 손동작 카드 이미지를 하단 중앙에 그리는 헬퍼 (분신술 기존 방식과 동일)
function drawStateImg(img) {
  if (!img.complete || !img.naturalWidth) return;
  const imgW = 120;
  const imgH = img.naturalHeight * (imgW / img.naturalWidth);
  ctx.drawImage(
      img,
      (canvas.width - imgW) / 2,
      canvas.height - imgH - 16,
      imgW, imgH
  );
}

// ------------------------------------------------------
// 시각 효과: 라센간
// ------------------------------------------------------
function drawRasengan(cx, cy, radius, t) {
  ctx.save();

  // 1. 맥동 충격파 링 (3개, 서로 다른 위상)
  for (let w = 0; w < 3; w++) {
    const waveOffset = (w * Math.PI * 2) / 3;
    const waveRadius = radius * (1.6 + 0.6 * Math.sin(t * 0.006 + waveOffset));
    const waveAlpha = 0.15 + 0.1 * Math.sin(t * 0.006 + waveOffset);
    const wGrad = ctx.createRadialGradient(cx, cy, waveRadius * 0.85, cx, cy, waveRadius * 1.05);
    wGrad.addColorStop(0, `rgba(80,180,255,0)`);
    wGrad.addColorStop(0.5, `rgba(160,225,255,${waveAlpha})`);
    wGrad.addColorStop(1, `rgba(80,180,255,0)`);
    ctx.fillStyle = wGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, waveRadius * 1.05, 0, Math.PI * 2);
    ctx.fill();
  }

  // 2. 외부 에너지 오라 (넓은 후광)
  const outerGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius * 2.8);
  outerGrad.addColorStop(0,   "rgba(120,210,255,0.25)");
  outerGrad.addColorStop(0.35,"rgba(60,150,255,0.18)");
  outerGrad.addColorStop(0.7, "rgba(20,80,200,0.08)");
  outerGrad.addColorStop(1,   "rgba(0,0,100,0)");
  ctx.fillStyle = outerGrad;
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 2.8, 0, Math.PI * 2);
  ctx.fill();

  // 3. 회전 소용돌이 껍질 — 8가닥, 안팎 교차
  ctx.shadowColor = "#7dd3fc";
  ctx.shadowBlur = 22;
  const STRANDS = 8;
  for (let k = 0; k < STRANDS; k++) {
    const phase = t * (k % 2 === 0 ? 0.018 : -0.014) + (k * Math.PI * 2) / STRANDS;
    const innerR = radius * 0.25;
    const outerR = radius * 1.1;
    ctx.strokeStyle = k % 2 === 0
        ? `rgba(255,255,255,${0.75 + 0.2 * Math.sin(t * 0.02 + k)})`
        : `rgba(130,215,255,${0.55 + 0.2 * Math.sin(t * 0.02 + k)})`;
    ctx.lineWidth = k % 2 === 0 ? 2.8 : 1.6;
    ctx.beginPath();
    const STEPS = 80;
    for (let s = 0; s <= STEPS; s++) {
      const frac = s / STEPS;
      const r = innerR + (outerR - innerR) * frac;
      const angle = phase + frac * Math.PI * 3.5; // 1.75바퀴 감김
      const x = cx + Math.cos(angle) * r;
      const y = cy + Math.sin(angle) * r;
      if (s === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // 4. 중간 에너지 링 (단단한 구체 껍질 표현)
  ctx.shadowBlur = 12;
  const ringGrad = ctx.createRadialGradient(cx, cy, radius * 0.75, cx, cy, radius * 1.15);
  ringGrad.addColorStop(0,   "rgba(60,160,255,0)");
  ringGrad.addColorStop(0.4, "rgba(140,210,255,0.55)");
  ringGrad.addColorStop(0.7, "rgba(200,235,255,0.75)");
  ringGrad.addColorStop(1,   "rgba(60,160,255,0)");
  ctx.fillStyle = ringGrad;
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 1.15, 0, Math.PI * 2);
  ctx.fill();

  // 5. 압축 코어 (중심 흰색 → 파란 그라디언트)
  const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius * 0.72);
  coreGrad.addColorStop(0,    "rgba(255,255,255,1)");
  coreGrad.addColorStop(0.2,  "rgba(230,248,255,0.98)");
  coreGrad.addColorStop(0.55, "rgba(150,220,255,0.88)");
  coreGrad.addColorStop(0.85, "rgba(60,140,255,0.55)");
  coreGrad.addColorStop(1,    "rgba(20,80,220,0)");
  ctx.fillStyle = coreGrad;
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 0.72, 0, Math.PI * 2);
  ctx.fill();

  // 6. 내부 회전 격자 (십자 + 대각선 — 압축 에너지 격자 느낌)
  ctx.save();
  ctx.globalAlpha = 0.22;
  ctx.strokeStyle = "rgba(200,240,255,0.9)";
  ctx.lineWidth = 1.2;
  ctx.shadowBlur = 0;
  const gridLines = 6;
  for (let g = 0; g < gridLines; g++) {
    const angle = t * 0.012 + (g * Math.PI) / gridLines;
    const x1 = cx + Math.cos(angle) * radius * 0.68;
    const y1 = cy + Math.sin(angle) * radius * 0.68;
    const x2 = cx - Math.cos(angle) * radius * 0.68;
    const y2 = cy - Math.sin(angle) * radius * 0.68;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }
  ctx.restore();

  // 7. 궤도 에너지 입자 (2궤도, 반대방향 회전)
  ctx.shadowColor = "#bae6fd";
  ctx.shadowBlur = 14;
  const ORBIT1 = 10, ORBIT2 = 7;
  for (let i = 0; i < ORBIT1; i++) {
    const angle = t * 0.012 + (i * Math.PI * 2) / ORBIT1;
    const orbitR = radius * (0.88 + Math.sin(t * 0.018 + i * 0.9) * 0.08);
    ctx.beginPath();
    ctx.arc(cx + Math.cos(angle) * orbitR, cy + Math.sin(angle) * orbitR, 3.8, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(220,245,255,0.95)";
    ctx.fill();
  }
  for (let i = 0; i < ORBIT2; i++) {
    const angle = -t * 0.009 + (i * Math.PI * 2) / ORBIT2;
    const orbitR = radius * (0.55 + Math.sin(t * 0.022 + i * 1.3) * 0.07);
    ctx.beginPath();
    ctx.arc(cx + Math.cos(angle) * orbitR, cy + Math.sin(angle) * orbitR, 2.4, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(180,230,255,0.85)";
    ctx.fill();
  }

  // 8. 코어 중심 스파크 (극점 플래시)
  const flashAlpha = 0.5 + 0.5 * Math.sin(t * 0.035);
  const flashGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius * 0.18);
  flashGrad.addColorStop(0, `rgba(255,255,255,${flashAlpha})`);
  flashGrad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = flashGrad;
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 0.18, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

// ------------------------------------------------------
// 시각 효과: 치도리 (강화판)
// ------------------------------------------------------
function drawLightningBolt(x0, y0, angle, length, branchDepth, alpha = 1) {
  const segs = 10;
  const jitter = length * 0.38;
  const points = [[x0, y0]];
  for (let j = 1; j <= segs; j++) {
    const r = (length * j) / segs;
    const off = (Math.random() - 0.5) * jitter;
    const nx = x0 + Math.cos(angle) * r + Math.cos(angle + Math.PI / 2) * off;
    const ny = y0 + Math.sin(angle) * r + Math.sin(angle + Math.PI / 2) * off;
    points.push([nx, ny]);
  }
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  points.slice(1).forEach(([x, y]) => ctx.lineTo(x, y));
  ctx.globalAlpha = alpha;
  ctx.stroke();
  ctx.globalAlpha = 1;

  // 재귀 가지 (최대 2단계)
  if (branchDepth > 0 && Math.random() < 0.6) {
    const bi = Math.floor(points.length * 0.3 + Math.random() * points.length * 0.45);
    const [bx, by] = points[bi];
    const branchAngle = angle + (Math.random() - 0.5) * 1.4;
    const prevLW = ctx.lineWidth;
    ctx.lineWidth = prevLW * 0.5;
    drawLightningBolt(bx, by, branchAngle, length * 0.5, branchDepth - 1, alpha * 0.75);
    ctx.lineWidth = prevLW;
  }
}

function drawChidori(cx, cy, radius, t) {
  ctx.save();

  // 1. 원거리 전기장 플리커 (전체 배경 오라)
  const flickerAlpha = 0.06 + 0.05 * Math.sin(t * 0.07 + Math.random() * 0.3);
  const farGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius * 3.5);
  farGrad.addColorStop(0,   `rgba(200,240,255,${flickerAlpha * 2})`);
  farGrad.addColorStop(0.3, `rgba(100,200,255,${flickerAlpha})`);
  farGrad.addColorStop(0.7, `rgba(40,120,255,${flickerAlpha * 0.4})`);
  farGrad.addColorStop(1,   "rgba(0,0,120,0)");
  ctx.fillStyle = farGrad;
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 3.5, 0, Math.PI * 2);
  ctx.fill();

  // 2. 충격파 맥동 링 (2개, 반대 위상)
  for (let w = 0; w < 2; w++) {
    const wPhase = w * Math.PI;
    const wR = radius * (1.8 + 0.5 * Math.sin(t * 0.009 + wPhase));
    const wAlpha = 0.12 + 0.08 * Math.sin(t * 0.009 + wPhase);
    const wGrad = ctx.createRadialGradient(cx, cy, wR * 0.88, cx, cy, wR * 1.08);
    wGrad.addColorStop(0,   "rgba(180,230,255,0)");
    wGrad.addColorStop(0.5, `rgba(220,245,255,${wAlpha})`);
    wGrad.addColorStop(1,   "rgba(180,230,255,0)");
    ctx.fillStyle = wGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, wR * 1.08, 0, Math.PI * 2);
    ctx.fill();
  }

  // 3. 넓은 전기 후광
  const outerGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius * 2.4);
  outerGrad.addColorStop(0,   "rgba(255,255,255,0.5)");
  outerGrad.addColorStop(0.25,"rgba(180,230,255,0.38)");
  outerGrad.addColorStop(0.6, "rgba(60,130,255,0.12)");
  outerGrad.addColorStop(1,   "rgba(0,0,120,0)");
  ctx.fillStyle = outerGrad;
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 2.4, 0, Math.PI * 2);
  ctx.fill();

  // 4. 코어 플래시 (맥동)
  const coreFlicker = 0.85 + 0.15 * Math.sin(t * 0.045);
  const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius * 0.65 * coreFlicker);
  coreGrad.addColorStop(0,   "rgba(255,255,255,1)");
  coreGrad.addColorStop(0.3, "rgba(230,248,255,0.95)");
  coreGrad.addColorStop(0.65,"rgba(140,210,255,0.7)");
  coreGrad.addColorStop(1,   "rgba(80,160,255,0)");
  ctx.fillStyle = coreGrad;
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 0.65 * coreFlicker, 0, Math.PI * 2);
  ctx.fill();

  // 5. 주 번개 (24가닥 — 홀짝 두께/색 교차, 랜덤 깜빡임)
  ctx.shadowColor = "#bae6fd";
  ctx.shadowBlur = 24;
  const BOLTS = 24;
  for (let i = 0; i < BOLTS; i++) {
    const baseAngle = (Math.PI * 2 * i) / BOLTS
        + Math.sin(t * 0.022 + i * 1.1) * 0.45;
    const length = radius * (1.5 + Math.random() * 1.2);
    const flicker = Math.random() > 0.15; // 15% 확률로 깜빡 꺼짐
    if (!flicker) continue;

    if (i % 3 === 0) {
      ctx.strokeStyle = "rgba(255,255,255,1)";
      ctx.lineWidth = 2.8;
    } else if (i % 3 === 1) {
      ctx.strokeStyle = "rgba(180,235,255,0.88)";
      ctx.lineWidth = 1.6;
    } else {
      ctx.strokeStyle = "rgba(120,200,255,0.7)";
      ctx.lineWidth = 1.0;
    }
    drawLightningBolt(cx, cy, baseAngle, length, 2);
  }

  // 6. 코로나 방전 — 짧은 표면 번개 (코어 주변)
  ctx.shadowBlur = 12;
  const CORONA = 10;
  for (let i = 0; i < CORONA; i++) {
    const angle = t * 0.025 * (i % 2 === 0 ? 1 : -1) + (i * Math.PI * 2) / CORONA;
    const startR = radius * 0.55;
    const sx = cx + Math.cos(angle) * startR;
    const sy = cy + Math.sin(angle) * startR;
    const coronaLen = radius * (0.35 + Math.random() * 0.3);
    ctx.strokeStyle = "rgba(220,248,255,0.9)";
    ctx.lineWidth = 1.2;
    drawLightningBolt(sx, sy, angle + (Math.random() - 0.5) * 1.5, coronaLen, 1, 0.8);
  }

  // 7. 회전 스파크 입자 (2레이어)
  ctx.shadowColor = "#e0f7ff";
  ctx.shadowBlur = 16;
  // 바깥 레이어
  for (let i = 0; i < 10; i++) {
    const angle = t * 0.028 * (i % 2 === 0 ? 1 : -1) + (i * Math.PI * 2) / 10;
    const sr = radius * (0.75 + Math.sin(t * 0.035 + i * 0.8) * 0.15);
    const size = 2.5 + Math.random() * 1.5;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(angle) * sr, cy + Math.sin(angle) * sr, size, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.fill();
  }
  // 안쪽 레이어 (반대 방향)
  for (let i = 0; i < 7; i++) {
    const angle = -t * 0.02 + (i * Math.PI * 2) / 7;
    const sr = radius * (0.38 + Math.sin(t * 0.04 + i) * 0.08);
    ctx.beginPath();
    ctx.arc(cx + Math.cos(angle) * sr, cy + Math.sin(angle) * sr, 1.8, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(200,240,255,0.85)";
    ctx.fill();
  }

  // 8. 중심 극점 플래시
  const flashA = 0.6 + 0.4 * Math.sin(t * 0.055);
  const flashGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius * 0.2);
  flashGrad.addColorStop(0, `rgba(255,255,255,${flashA})`);
  flashGrad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = flashGrad;
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 0.2, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

// ------------------------------------------------------
// 시각 효과: 호화멸각 (화염)
// ------------------------------------------------------
const fireParticles = [];

function spawnFire(cx, cy, dirX, dirY, count = 5) {
  for (let i = 0; i < count; i++) {
    const spread = 0.6;
    const vx = dirX + (Math.random() - 0.5) * spread;
    const vy = dirY + (Math.random() - 0.5) * spread;
    const speed = 5 + Math.random() * 6;
    fireParticles.push({
      x: cx + (Math.random() - 0.5) * 20,
      y: cy + (Math.random() - 0.5) * 20,
      vx: vx * speed,
      vy: vy * speed,
      size: 24 + Math.random() * 26,
      life: 1.0,
      decay: 0.012 + Math.random() * 0.01,
    });
  }
}

function drawFireParticles() {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (let i = fireParticles.length - 1; i >= 0; i--) {
    const p = fireParticles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.vy -= 0.12;
    p.life -= p.decay;
    p.size *= 1.025;
    if (p.life <= 0) {
      fireParticles.splice(i, 1);
      continue;
    }
    const l = p.life;
    const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size);
    grad.addColorStop(0, `rgba(255,255,220,${l})`);
    grad.addColorStop(0.25, `rgba(255,180,40,${l * 0.95})`);
    grad.addColorStop(0.6, `rgba(230,60,10,${l * 0.6})`);
    grad.addColorStop(1, `rgba(50,0,0,0)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// ------------------------------------------------------
// 시각 효과: 분신술 (影分身) - SelfieSegmentation + 스프라이트 연기
// ------------------------------------------------------
let mask = null;

const SMOKE_FOLDERS = ["smoke_1", "smoke_2", "smoke_3"];
const SMOKE_FRAME_COUNT = 5;
const SMOKE_DURATION = 600;
const activeSpriteSmokes = [];

function spawnSpriteSmoke(x, y, scale) {
  const folder = SMOKE_FOLDERS[Math.floor(Math.random() * SMOKE_FOLDERS.length)];
  const frames = [];
  for (let i = 1; i <= SMOKE_FRAME_COUNT; i++) {
    const img = new Image();
    img.src = `${ASSETS_PATH}/${folder}/${i}.png`;
    frames.push(img);
  }
  activeSpriteSmokes.push({ x, y, scale: scale * 1.2, start: performance.now(), frames });
}

function drawSpriteSmokes() {
  const now = performance.now();
  for (let i = activeSpriteSmokes.length - 1; i >= 0; i--) {
    const s = activeSpriteSmokes[i];
    const frameIndex = Math.floor((now - s.start) / (SMOKE_DURATION / SMOKE_FRAME_COUNT));
    if (frameIndex >= s.frames.length) { activeSpriteSmokes.splice(i, 1); continue; }
    const img = s.frames[frameIndex];
    if (!img.complete || !img.naturalWidth) continue;
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.scale(s.scale, s.scale);
    ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
    ctx.restore();
  }
}

// 좌우반전된 마스크 + 비디오로 사람 오려내기
function grabPerson() {
  const offscreen = document.createElement("canvas");
  offscreen.width = canvas.width;
  offscreen.height = canvas.height;
  const tempCtx = offscreen.getContext("2d");
  tempCtx.save();
  tempCtx.scale(-1, 1);
  tempCtx.drawImage(mask, -canvas.width, 0, canvas.width, canvas.height);
  tempCtx.restore();
  tempCtx.globalCompositeOperation = "source-in";
  tempCtx.save();
  tempCtx.scale(-1, 1);
  tempCtx.drawImage(video, -canvas.width, 0, canvas.width, canvas.height);
  tempCtx.restore();
  tempCtx.globalCompositeOperation = "source-over";
  return offscreen;
}

const customClones = [
  { x: -100, y: 100, scale: 0.9,  delay: 1000, smokeSpawned: false },
  { x:  120, y: 100, scale: 0.85, delay: 1150, smokeSpawned: false },
  { x: -180, y: 140, scale: 0.8,  delay: 1300, smokeSpawned: false },
  { x: -140, y: 140, scale: 0.45, delay: 1320, smokeSpawned: false },
  { x:  180, y: 160, scale: 0.7,  delay: 1450, smokeSpawned: false },
  { x:  140, y: 160, scale: 0.4,  delay: 1470, smokeSpawned: false },
  { x: -250, y: 140, scale: 0.7,  delay: 1600, smokeSpawned: false },
  { x: -220, y: 140, scale: 0.35, delay: 1620, smokeSpawned: false },
  { x:  260, y: 160, scale: 0.65, delay: 1750, smokeSpawned: false },
  { x: -100, y: 150, scale: 0.6,  delay: 2500, smokeSpawned: false },
  { x:  100, y: 150, scale: 0.6,  delay: 2650, smokeSpawned: false },
  { x: -120, y:  70, scale: 0.55, delay: 2800, smokeSpawned: false },
  { x:  100, y:  70, scale: 0.5,  delay: 2950, smokeSpawned: false },
  { x: -200, y:  85, scale: 0.55, delay: 3100, smokeSpawned: false },
  { x:  230, y:  85, scale: 0.5,  delay: 3250, smokeSpawned: false },
  { x: -280, y: 100, scale: 0.4,  delay: 3400, smokeSpawned: false },
];
const BUNSHIN_EFFECT_DURATION = 5000;

function drawBunshinClones(person, elapsed) {
  const sorted = [...customClones].sort((a, b) => b.delay - a.delay);
  sorted.forEach(cl => {
    if (elapsed < cl.delay) return;
    if (!cl.smokeSpawned) {
      cl.smokeSpawned = true;
      const centerX = cl.x + canvas.width / 2;
      const centerY = cl.y + canvas.height / 2 - 40;
      spawnSpriteSmoke(centerX - 15, centerY, cl.scale);
      spawnSpriteSmoke(centerX + 15, centerY, cl.scale);
    }
    ctx.save();
    ctx.translate(cl.x + canvas.width * (1 - cl.scale) / 2, cl.y);
    ctx.scale(cl.scale, cl.scale);
    ctx.drawImage(person, 0, 0);
    ctx.restore();
  });
  ctx.drawImage(person, 0, 0); // 원본 항상 최상단
}

function resetBunshinClones() {
  customClones.forEach(cl => cl.smokeSpawned = false);
  activeSpriteSmokes.length = 0;
}

// ------------------------------------------------------
// 손 스켈레톤 그리기
// ------------------------------------------------------
function drawHandSkeleton(lm, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  const chains = [
    [0, 1, 2, 3, 4],
    [0, 5, 6, 7, 8],
    [0, 9, 10, 11, 12],
    [0, 13, 14, 15, 16],
    [0, 17, 18, 19, 20],
  ];
  for (const chain of chains) {
    ctx.beginPath();
    chain.forEach((i, idx) => {
      const x = (1 - lm[i].x) * canvas.width;
      const y = lm[i].y * canvas.height;
      if (idx === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }
  ctx.fillStyle = color;
  lm.forEach(p => {
    ctx.beginPath();
    ctx.arc((1 - p.x) * canvas.width, p.y * canvas.height, 3, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();
}

// ------------------------------------------------------
// 이펙트 렌더링
// ------------------------------------------------------
function renderActiveEffect(res, now) {
  const elapsed = now - activeEffect.start;
  const progress = elapsed / activeEffect.duration;
  const right = res.rightHandLandmarks;
  const left = res.leftHandLandmarks;

  if (activeEffect.type === "rasengan") {
    if (right && left) {
      const rp = palmCenter(right);
      const lp = palmCenter(left);
      lastRasenganPos = {
        cx: (1 - (rp.x + lp.x) / 2) * canvas.width,
        cy: ((rp.y + lp.y) / 2) * canvas.height,
        radius: Math.max(90, dist2D(rp, lp) * canvas.width * 0.9),
      };
    } else if (right || left) {
      const p = palmCenter(right || left);
      lastRasenganPos = {
        cx: (1 - p.x) * canvas.width,
        cy: p.y * canvas.height,
        radius: 100,
      };
    }
    if (lastRasenganPos) {
      const pulse = 1 + Math.sin(now * 0.008) * 0.1;
      const fade = progress > 0.85 ? (1 - progress) / 0.15 : 1;
      ctx.save();
      ctx.globalAlpha = fade;
      drawRasengan(lastRasenganPos.cx, lastRasenganPos.cy, lastRasenganPos.radius * pulse, now);
      ctx.restore();
    }
  }

  else if (activeEffect.type === "chidori") {
    const hand = right || left;
    if (hand) {
      const p = palmCenter(hand);
      lastChidoriPos = {
        cx: (1 - p.x) * canvas.width,
        cy: p.y * canvas.height,
      };
    }
    if (lastChidoriPos) {
      const radius = 85 + Math.sin(now * 0.02) * 15;
      const fade = progress > 0.85 ? (1 - progress) / 0.15 : 1;
      ctx.save();
      ctx.globalAlpha = fade;
      drawChidori(lastChidoriPos.cx, lastChidoriPos.cy, radius, now);
      ctx.restore();
    }
  }

  else if (activeEffect.type === "fireball") {
    const pose = res.poseLandmarks;
    let cx, cy;
    if (pose && pose[0]) {
      const nose = pose[0];
      cx = (1 - nose.x) * canvas.width;
      cy = nose.y * canvas.height + 40;
    } else {
      cx = canvas.width / 2;
      cy = canvas.height / 2;
    }
    if (progress < 0.85) {
      spawnFire(cx, cy, 0, 0.6, 3);
      spawnFire(cx, cy, -0.5, 0.3, 2);
      spawnFire(cx, cy, 0.5, 0.3, 2);
    }
    drawFireParticles();
    drawStateImg(JUTSU_STATE_IMG[activeEffect.type]);
    return; // ← 조기 리턴으로 맨 끝 공통 drawStateImg 중복 방지
  }

  else if (activeEffect.type === "bunshin") {
    ctx.save();
    ctx.scale(-1, 1);
    ctx.drawImage(video, -canvas.width, 0, canvas.width, canvas.height);
    ctx.restore();
    if (mask) {
      const person = grabPerson();
      drawBunshinClones(person, elapsed);
    }
  }

  // 모든 인술에서 하단 중앙 카드 이미지 표시 (분신술 포함)
  drawStateImg(JUTSU_STATE_IMG[activeEffect.type]);
}

// ------------------------------------------------------
// MediaPipe SelfieSegmentation
// ------------------------------------------------------
const selfie = new SelfieSegmentation({
  locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${f}`
});
selfie.setOptions({ modelSelection: 1 });
selfie.onResults(r => { mask = r.segmentationMask; });

// ------------------------------------------------------
// MediaPipe Holistic
// ------------------------------------------------------
const holistic = new Holistic({
  locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/holistic/${f}`
});
holistic.setOptions({
  modelComplexity: 1,
  smoothLandmarks: true,
  minDetectionConfidence: 0.5,
  minTrackingConfidence: 0.5,
});

holistic.onResults(res => {
  canvas.width = video.videoWidth || 640;
  canvas.height = video.videoHeight || 480;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const isBunshin = activeEffect && activeEffect.type === "bunshin";

  // 분신술 중에는 renderActiveEffect 안에서 비디오를 그림
  if (!isBunshin) {
    ctx.save();
    ctx.scale(-1, 1);
    ctx.drawImage(video, -canvas.width, 0, canvas.width, canvas.height);
    ctx.restore();
  }

  const right = res.rightHandLandmarks;
  const left = res.leftHandLandmarks;

  // 분신술 중에는 스켈레톤 생략
  if (!isBunshin) {
    if (right) drawHandSkeleton(right, "#4ade80");
    if (left) drawHandSkeleton(left, "#60a5fa");
  }

  const now = performance.now();

  // 이펙트 종료 체크
  if (activeEffect && (now - activeEffect.start >= activeEffect.duration)) {
    lastActivationEnd = now;
    activeEffect = null;
  }

  if (!activeEffect && (now - lastActivationEnd > COOLDOWN_MS)) {
    const detected = detectJutsu(right, left);

    if (detected && detected === currentDetecting) {
      badFrames = 0;
      const elapsed = now - holdStartTime;
      updateUIProgress(detected, elapsed / HOLD_DURATION_MS);
      if (elapsed >= HOLD_DURATION_MS) {
        activateJutsu(detected);
        currentDetecting = null;
        holdStartTime = null;
        badFrames = 0;
      }
    } else if (detected && !currentDetecting) {
      currentDetecting = detected;
      holdStartTime = now;
      badFrames = 0;
      updateUIProgress(detected, 0);
    } else {
      badFrames++;
      if (badFrames >= RESET_TOLERANCE) {
        currentDetecting = detected || null;
        holdStartTime = detected ? now : null;
        badFrames = 0;
        updateUIProgress(currentDetecting, 0);
      }
    }
  }

  // 이펙트 렌더
  if (activeEffect) {
    renderActiveEffect(res, now);
  }

  // 파티클은 항상 그림 (페이드아웃 효과 위해)
  if (!(activeEffect && activeEffect.type === "fireball")) {
    drawFireParticles();
  }

  drawSpriteSmokes();
});

// ------------------------------------------------------
// 카메라 시작
// ------------------------------------------------------
const camera = new Camera(video, {
  width: 640,
  height: 480,
  onFrame: async () => {
    await selfie.send({ image: video });
    await holistic.send({ image: video });
  },
});

camera.start()
    .then(() => {
      statusEl.textContent = "카메라 ON — 결인을 맺어보세요! 🥷";
    })
    .catch(err => {
      statusEl.textContent = "⚠ 카메라 접근 실패: " + err.message;
    });