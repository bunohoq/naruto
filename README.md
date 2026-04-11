# 🥷 나루토 결인 인술 시뮬레이터

웹캠과 손동작만으로 나루토 인술을 시전하는 브라우저 앱입니다.  
MediaPipe Holistic으로 손 랜드마크(21개)를 실시간 추적하고, 규칙 기반 제스처 판정으로 인술을 발동합니다.  
별도의 ML 모델 학습 없이 바로 실행됩니다.

---

## 🔥 지원 인술

| 인술 | 손동작 | 이펙트 | 지속 시간 |
|------|--------|--------|-----------|
| 螺旋丸 라센간 | 양손 모두 펴고 위아래로 겹치기 | 파란 회전 에너지 구체 + 소용돌이 | 3초 |
| 千鳥 치도리 | 한 손만 펴고 손끝을 아래로 내리기 | 24가닥 번개 + 코로나 방전 | 3초 |
| 火遁 호화멸각 | 양 검지만 세워서 가까이 모으기 | 화염 파티클 | 3초 |
| 影分身 분신술 | 양손 ✌✌ 검지+중지 교차 | 분신 16개 복제 + 연기 스프라이트 | 5초 |

---

## 🎮 결인 방법 상세

### 螺旋丸 라센간
- 양손 손가락을 모두 펴기
- 한 손이 다른 손보다 위에 오도록 세로로 겹치기
- 두 손의 좌우 위치가 가까울수록 잘 인식됨

### 千鳥 치도리
- **한 손만** 카메라에 보이도록 하기
- 엄지는 접고, 검지~소지 4개만 펴기
- 손끝이 아래를 향하도록 화면 하단으로 내리기

### 火遁 호화멸각
- 양손을 가까이 붙이기 (호랑이 결인)
- 검지만 위로 세우고 나머지 손가락은 접기
- 두 검지가 모두 위를 향해야 인식됨

### 影分身 분신술
- 양손 검지 + 중지만 펴기 (✌ 모양)
- 두 손을 가까이 붙이고 검지가 서로 교차하도록 X자 만들기
- 두 검지의 방향이 60° 이상 벌어질 때 인식됨

---

## 🛠 기술 스택

- **MediaPipe Holistic** — 양손 랜드마크 21개 실시간 추적 (modelComplexity: 1)
- **MediaPipe Selfie Segmentation** — 인물/배경 분리 (분신술 복제 효과용)
- **Canvas 2D API** — 라센간·치도리·화염·분신 이펙트 직접 렌더링
- **Vanilla JS** — 프레임워크 없음, CDN만 사용

---

## 🚀 실행 방법

### 사전 준비

- **Chrome** 권장 (Safari 일부 기능 제한)
- **웹캠** 필수

### 실행

```bash
# 프로젝트 폴더로 이동 후
python3 -m http.server 8000
```

브라우저에서 `http://localhost:8000` 접속 → 카메라 권한 허용

> `file://` 프로토콜로 직접 열면 카메라 접근이 차단됩니다. 반드시 로컬 서버로 실행하세요.

---

## 📁 파일 구조

```
├── index.html              # 메인 UI
├── script.js               # 제스처 감지 + 이펙트 렌더링
├── styles.css              # 스타일
└── assets/
    ├── state-2.png         # 분신술 손동작 카드 이미지
    ├── state-3.png         # 라센간 손동작 카드 이미지
    ├── state-4.png         # 호화멸각 손동작 카드 이미지
    ├── state-5.png         # 치도리 손동작 카드 이미지
    ├── smoke_1/            # 연기 스프라이트 A (5프레임)
    ├── smoke_2/            # 연기 스프라이트 B (5프레임)
    ├── smoke_3/            # 연기 스프라이트 C (5프레임)
    └── smoke_small_1/      # 소형 연기 스프라이트 (5프레임)
```

---

## ⚙️ 동작 원리

```
웹캠 프레임 입력 (640×480)
↓
MediaPipe Holistic — 양손 랜드마크 21개 추출
MediaPipe SelfieSegmentation — 인물 마스크 추출 (분신술용)
↓
규칙 기반 제스처 판정
  - 손가락 펴짐 여부 (tip ↔ wrist 거리 비교)
  - 양손 간격 / 방향 벡터 내적
  - 손바닥 위치 (화면 내 y좌표)
↓
0.6초 홀딩 유지 → 진행도 바 표시
↓
인술 발동 → Canvas 이펙트 렌더링 (3~5초)
↓
0.5초 쿨다운 후 재인식 가능
```

---

## 💡 인식이 잘 되는 환경

- 밝은 조명
- 단색 배경 (분신술 특히 중요)
- 양손이 카메라 프레임 안에 모두 보이는 위치
- Chrome 브라우저 사용

---

## ⚙️ 커스터마이징

`script.js`에서 조정 가능합니다.

```js
const HOLD_DURATION_MS = 600;  // 제스처 홀딩 시간 (ms) — 낮출수록 빠르게 발동
const EFFECT_DURATION  = 3000; // 이펙트 지속 시간 (ms)
const RESET_TOLERANCE  = 10;   // 흔들림 허용 프레임 수 — 높일수록 오인식 줄어듦
const COOLDOWN_MS      = 500;  // 인술 발동 후 재인식 대기 시간 (ms)
```

분신술 이펙트 지속 시간은 별도 상수(`BUNSHIN_EFFECT_DURATION = 5000`)로 관리됩니다.

---

## 🙏 참고

- [nasha-wanich/naruto-shadow-clone-jutsu](https://github.com/nasha-wanich/naruto-shadow-clone-jutsu) — 분신술 이펙트 및 연기 스프라이트 참고
- [MediaPipe Holistic](https://developers.google.com/mediapipe/solutions/vision/holistic_landmarker)
- [MediaPipe Selfie Segmentation](https://developers.google.com/mediapipe/solutions/vision/image_segmenter)
