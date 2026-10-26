# PROGRESS

API 키 없음 — 민우가 Cursor 클라우드 에이전트 Secrets(MODEL_API_KEY 또는 META_API_KEY, BASETEN_API_KEY)에 등록해야 실제 호출 검사 가능

## 2026-10-27 (KST)

### 한 일
- 브랜치 `cursor/day1-gravity-tipover-633c`에서 Vite + TypeScript 웹앱, Vercel `/api` 함수, 센서·물리·SAM 파서·합성 파이프라인을 새로 씀.
- 환경 변수 존재 여부만 확인: `MODEL_API_KEY` unset, `META_API_KEY` unset, `BASETEN_API_KEY` unset. 값은 보지 않음.
- 키 없이 한 실호출 하나: `GET https://api.meta.ai/v1/status` (인증 없음).
  - 원문: `{"is_alive":true,"service_status":"operational","service_message":"","updated_at":"","model_statuses":[]}`
- `GET /v1/models`, `muse-wonder-1.0`, SAM, Baseten는 키가 없어 호출하지 않음. 가짜 응답 없음.
- 공식 문서에서 다시 확인: Wonder/Wonder Full은 한국에서 Model API·Muse Code 모두 불가(https://dev.meta.ai/docs/models).
- DECISIONS-SEED를 DECISIONS.md에 원문 그대로 옮김.
- `npm test`: 12파일 / 28테스트 통과. `npm run lint` 통과. `npm run build` 통과 (Vite 8.3.5, JS 18.27 kB).
- 로컬 서버에서 실측:
  - `GET /api/status` → `modelApiKeyConfigured: false`, `basetenApiKeyConfigured: false`
  - `POST /api/sam` → 503, 원문 오류: `MODEL_API_KEY / META_API_KEY is not configured. Refusing to invent a model result.`
  - Chrome 390×844에서 **Load synthetic example** 클릭 후 카드: `d = 0.1100 m`, now unstable `no`, P(unstable) `0.0%`, MC std(d) `0.0021 m`. SAM 버튼 disabled. 캔버스 비트맵 390×520.

### 막힌 일
- 실제 SAM·Wonder·Spark Open 호출 검사 불가(키 없음).
- 공식 SAM `~` / `!` 마스크의 base85 이후 바이트 배치: 문서에 없음. 디코드 안 함(확인 필요).
- 실제 휴대폰에서 중력 부호·화면 회전 매핑: 아직 못 재봄(확인 필요).
- Official Rules 원문(데모 길이, 공개 레포 의무, 금지 출품 등): 로그인 필요로 못 읽음(확인 필요).

### 다음 일
- 민우가 Secrets에 키 등록.
- 키 들어오면 `GET /v1/models` 원문, `muse-wonder-1.0` 1회 호출 원문을 기록. 전체가 막히면 맨 위에 적고 멈춤.
- 키 있으면 SAM 3.1 실호출로 영상 추적·마스크 디코드 확인.
- 실제 사진 하나로 d와 확률이 나오게 만들기(10/30 점검 ①).
