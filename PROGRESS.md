# PROGRESS

> 2026-10-27 09:30 KST부터 Claude Code가 그록봇 작업을 이어받아 주 개발을 맡음(민우 결정 「A로 하자, 네가 맡아줘」). 아래 첫 절이 최신.

## 2026-10-27 (KST) · 오후: 외부 검토 반영, 개선 전후, 기울여 넘어뜨리기 검증

### 한 일
- 민우가 ChatGPT에 백지에서 입상안을 물었고, 재평가 결과 이 안을 유지하되 과장된 주장을 빼라는 결론. 지적을 반영함(DECISIONS D6).
- 지어낸 건드림 빈도로 내던 「30일 안 떨어질 확률」과 `fall_probability`·`required_margin` 도구를 지움. 가능성은 측정 여유의 하위 5% 값으로 **제안**(0 / 1 / 3 / 10 cm 경계, 가정), 대책은 `move_target`(하위 5% 값을 10 cm까지, 가정).
- 중대성은 보호구 시험 에너지 대신 충돌 에너지 자릿수(1 / 10 / 100 J, 가정)로 **제안**.
- 표에서 관리감독자가 가능성·중대성·개선 후 가능성을 바꾸고, 위험성이 다시 계산됨. 내보내기에 제안값인지 관리감독자가 정한 값인지 남음.
- 사다리 기준각 75.96° → 75.52° 수정(OSHA 원문: 밑 거리 = 작업 길이의 1/4).
- 카메라 앞뒤 기울기(pitch) 표시와 15° 초과 경고.
- 개선 전후: 「다시 찍기」 버튼, 이전 사진을 반투명으로 겹쳐 같은 자리에서 촬영, 표에 이전 → 지금 여유와 두 사진.
- 기울여 넘어뜨리기 검증: 옆 사진으로 넘어지는 각도 예측(θc = atan(d/h)), 판 위 휴대폰으로 실제 각도 측정, 착지 충격 자동 감지 또는 버튼, 결과 JSON.
- 숫자 검사기: 자리표시 필드 이름에 숫자 허용(`d_p5_m`), 개선 후 위험성이 같은 중대성을 쓰는지 확인.

### 실제로 돌린 값
- `npm test` 13파일 67시험 통과, `npm run lint`·`tsc --noEmit`·`npm run build`·`npm run check:api` 통과(키 없음: status 200, 나머지 503).
- 합성 장면(synthetic 표시): d 6.0 cm, 하위 5% 5.2 cm → 가능성 제안 2, 중대성 제안 2(최대 7.26 J) → 위험성 4. 안쪽으로 4.8 cm 옮기면 개선 후 1 × 2 = 2. 관리감독자가 가능성을 4로 바꾸면 8로 다시 계산됨.
- 합성 장면의 기울여 넘어뜨리기 예측: 32.8°(정답 atan(45/70) = 32.7°), 5–95% 범위 27.5–38.2°.
- 390×844 화면(헤드리스 크로미엄)에서 콘솔 오류 0.

### 다음 일
- 민우: 실제 휴대폰으로 다림줄(문틀과 나란한지), pitch 표시, 기울기 측정기(판 위에서) 확인.
- 기울여 넘어뜨리기 실측 10회 이상을 EVAL.md에 기록(물체마다 예측 대 실제).
- 키가 들어오면 Baseten 실호출(도구 호출 지원 여부), 크레딧 확인 뒤 SAM 실호출.

## 2026-10-27 (KST) · Claude 인수 1일 차

### 한 일
- 그록봇 브랜치 `cursor/day1-gravity-tipover-633c` 위에 `claude/takeover-capture-sam`을 만들어 이어서 작업.
- **SAM 3.1 호출을 공식 형식으로 고침.** Meta가 공개한 `meta-models/meta-sam` 레포의 protocol/sam3.md와 playground 서버 코드에서 확인: 사진 요청은 `stream: false`(사진을 스트리밍으로 보내면 `response.failed`가 온다고 적혀 있음), 영상은 Files API(`purpose=user_data`, MP4만)로 올린 뒤 스트리밍. 그록봇 코드는 사진을 `stream: true`로 보내게 되어 있었음.
- **마스크 해독을 Meta 공식 패키지로.** `@meta-sam/parser` 0.1.0(npm, Meta 배포, SAM License) 도입. 그록봇이 「확인 필요」로 막혀 있던 `~`/`!` 마스크가 풀림. Meta가 공개한 실제 API 응답 표본(conformance `captured-api-image-lossless`)으로 해독 시험 통과. 라이선스 사본 `licenses/SAM-LICENSE.txt`.
- **넘어짐 여유 d를 다림줄 기준으로 다시 짬.** 그록봇은 모서리선을 두 번 탭해서 그었는데(중력을 안 씀), 이제는 모서리 한 점 + 휴대폰 중력으로 수직선을 긋고 그 수직선과 무게중심 사이 거리를 잼. 받침 마스크에서 모서리 꼭짓점을 자동으로 찾음. 부호(위/아래)와 무관하게 선만 쓰므로 iOS·안드로이드 부호 차이에 영향받지 않음.
- 몬테카를로(1,000회, 시드 20261027)에 무게중심·모서리·중력 방향·축척 오차를 함께 넣음.
- 위험성평가 계산부: 떨어질 확률(반사 랜덤워크 P = 2(1−Φ(d/σ√N))), 낙하 v·E, 중대성 등급(경계는 EN 397 안전모 시험 49 J, EN ISO 20345 안전화 시험 200 J에 맞춘 가정), 5×4 행렬, 한국어·영어 CSV·인쇄용 표.
- 평가 에이전트(Muse Spark Open, Baseten): 네이티브 도구 호출 + JSON 대체 경로. **숫자 검사기**: 표의 등급·점수는 모델이 쓰지 못하고 도구 결과 id를 가리키기만 함. 글에 숫자를 직접 쓰면 반려(최대 3번).
- 에이전트 없이 같은 도구로 표를 만드는 로컬 경로(키 없어도 동작).
- 휴대폰 화면 새로 씀: 카메라 위 실시간 다림줄·기울기, 중력과 함께 찍기, 탭으로 SAM 분할(키 있을 때) 또는 손으로 그리기, 축척·바닥 탭, 앵커·오르빗·d 표시, 평가 추적 로그, 한국어/영어 표.
- 장소별 「얼마나 자주 건드리는지」 가정 3단계(거의 안 건드림 0.5회/일·3 mm, 평소 책상 2회/일·3 mm, 여럿이 쓰는 작업대 10회/일·5 mm). 모두 가정으로 표시.
- 하루 호출 상한(인스턴스 메모리 기준, SAM 300·Spark 400)과 기기당 분당 12회 제한.
- Vercel 대비: 상대 import를 `.js`로 바꿈. `npm run check:api`가 파일별로 변환해 여섯 함수를 실제로 불러 봄.

### 실제로 돌린 값
- `npm test` 12파일 59시험 통과, `npm run lint` 통과, `tsc --noEmit` 통과, `npm run check:api` 통과(키 없음: status 200, 나머지 503).
- 합성 장면(휴대폰 6° 기울임, synthetic 표시): d 6.0 cm(정답 6.0 cm), 낙하 높이 74.0 cm(정답 74.0 cm), 기울기 보정 6.0°, 중력을 무시했다면 7.6 mm 틀림. 로컬 평가: 가능성 3(30일 안 1.1%, 평소 책상 가정) × 중대성 2(최대 7.26 J) = 6, 2.4 cm 안쪽으로 옮기면 4.
- 390×844 화면에서 콘솔 오류 0.

### 막힌 일
- 이 작업 환경은 `inference.baseten.co`·`api.meta.ai`에 나갈 수 없음(프록시). 키도 없음. 그래서 Baseten·SAM 실호출은 이 환경에서 아직 0회. 가짜 응답 없음.
- Meta 크레딧이 Billing → free credits에 뜨기 전에는 SAM을 부르지 않음(카드 과금).
- 실제 휴대폰에서 다림줄이 실제 수직(문틀)과 맞는지: 미확인.

### 다음 일
- 민우: Vercel 연결 + 환경 변수(BASETEN_API_KEY, META_API_KEY). 이 작업 환경에 허용 도메인·비밀값 추가.
- 휴대폰으로 미리보기 주소를 열어 다림줄이 문틀과 나란한지 확인.
- 키가 들어오면 「Check model connection」으로 Baseten 응답·도구 호출 지원 여부 기록, 실제 사진으로 SAM 분할.
- 10/30 점검: ① 실제 사진 한 장으로 d와 확률 ② Meta API·Baseten 실호출.

## 2026-10-27 (KST) · 그록봇 1일 차

> 그록봇 기록 원문. 「API 키 없음」 메모는 그 시점 기준.

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
