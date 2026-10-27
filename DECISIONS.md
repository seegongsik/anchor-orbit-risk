# DECISIONS 초안 (민우 지시 2026-10-26, t118u) — 개발 에이전트는 이 내용을 DECISIONS.md에 옮겨 적는다

## D1. Muse Spark Open 모델 이름: `meta-models/muse-spark-open-1026` (민우 확정)
- 일반 문서(dev.meta.ai/docs/muse-spark-open)에는 `meta-models/muse-spark-open`으로 나온다.
- 민우가 해커톤 참가자 안내(Baseten 항목)에서 확인한 문장: "For the hackathon, use meta-models/muse-spark-open-1026 instead". 이 안내 페이지는 로그인이 필요해 봇은 못 읽었다. 대회에서는 `-1026`을 쓴다. 호출이 실패하면 오류 원문을 PROGRESS.md에 적고 민우에게 알린다(이름을 마음대로 바꾸지 않는다).
- Baseten base URL(문서): https://inference.baseten.co/v1

## D2. Muse Wonder는 한국에서 쓸 수 없다고 문서에 적혀 있다
- 원문(2026-10-26 확인): "Muse Wonder and Muse Wonder Full aren't currently available in South Korea, on Model API or in Muse Code."
- 주소: https://dev.meta.ai/docs/models#muse-wonder-availability
- 대안: `muse-spark-1.3`. 영상을 통째로 넣지 않고 프레임을 뽑아 이미지로 넣는다(민우 지시).
- 첫날 API 키가 들어오면 `muse-wonder-1.0`을 실제로 한 번 호출해 결과(성공, 또는 오류 원문)를 기록한다.
- Meta Model API 전체가 한국에서 막혀 있으면 PROGRESS.md 맨 위에 적고 바로 알린다. 이것이 10/30 18:00 점검 ②번이다.
- 지역 우회(VPN 등)는 약관 위반이므로 쓰지 않는다.

## D3. Muse Voice는 음성→글자(STT) 모델이다
- 문서 원문: "It does not synthesize speech" (https://dev.meta.ai/docs/models#muse-voice-transcribe). 모델 `muse-voice-transcribe-1.0`, 25개 언어 지원.
- 그래서 높은 위험 알림을 읽어 주는 기능은 Meta API에 없다. 알림은 5개 언어 글로 한다(선택 기능, 민우 OK).

## D4. 2026-10-27 첫 구현에서 잠근 것 (키 없음)

- API 키: 이 실행에서 `MODEL_API_KEY`, `META_API_KEY`, `BASETEN_API_KEY`는 모두 unset. 그래서 `GET /v1/models`, `muse-wonder-1.0`, SAM, Baseten 실호출은 하지 않음. 가짜 응답 없음.
- 인증 없는 `GET https://api.meta.ai/v1/status` 는 실호출함. 원문: `{"is_alive":true,"service_status":"operational","service_message":"","updated_at":"","model_statuses":[]}`. 이 엔드포인트만으로는 Model API 전체가 한국에서 막혔는지 판단하지 않음.
- Wonder 한국 불가 문장은 2026-10-27에 https://dev.meta.ai/docs/models 에서 다시 확인: "Muse Wonder and Muse Wonder Full aren't currently available in South Korea, on Model API or in Muse Code."
- Vercel Function 본문 한도 4.5 MB: Vercel 문서(Functions limitations / 2026-10 knowledge update)에서 확인. 큰 사진은 URL 또는 Files API `file_id`로 넘기는 쪽으로 설계.
- SAM 파서: 공식 문법(https://dev.meta.ai/docs/sam/reading-segmentation)으로 줄·박스·마스크 헤더를 직접 파싱. `@meta-sam/parser`는 아직 쓰지 않음(다른 레포 코드 복사 금지, 패키지 도입은 민우 확인 후). 공식 `~` / `!` 마스크의 base85 이후 바이트 배치는 문서에 없어 디코드하지 않음(확인 필요). 테스트와 데모만 합성 인코딩 `#`(ASCII 0/1, synthetic 표시).
- 중력 부호: 정지 상태 `accelerationIncludingGravity`를 지지 가속도(W3C/MDN: 세운 폰에서 y ≈ +g)로 보고, 물체가 떨어지는 방향은 그 반대. 실제 폰에서 부호 확인 필요.
- 화면 문구·README·주석은 영어. PROGRESS.md만 한국어.
- Contributor 모델(`*-contributor`)은 민우 결정 전까지 쓰지 않음.
- Official Rules(데모 길이, 공개 레포 의무, 새 작업 시각, 금지 출품 등)는 로그인 필요로 봇이 못 읽음 → 확인 필요. 코드는 2026-10-27 02:00 KST 이후만.

## D5. 2026-10-27 Claude 인수 때 바꾼 설계 (민우 확인 필요 표시는 ★)

- **넘어짐 여유 d = 중력 수직선 기준.** 모서리 한 점(앵커)을 지나는 중력 방향 선과 무게중심 사이 거리를 중력에 수직인 방향으로 잰다. 두 점으로 그은 모서리선(그록봇 방식)은 중력을 쓰지 않아 휴대폰이 기울면 틀린다. 선만 쓰므로 가속도계 부호(위/아래) 규약과 무관하다.
- **모서리 자동 검출.** 받침(책상) 마스크 중 물체 바닥 높이 근처 띠에서 수평으로 가장 바깥 픽셀의 바깥 경계, 그 끝면의 맨 위를 앵커로 한다. 이미지 가장자리에 닿은 끝은 「안 보이는 모서리」로 뺀다.
- ★ **`@meta-sam/parser` 도입.** D4는 「민우 확인 후」라고 했으나, `~`/`!` 마스크의 해독 방식은 Meta 문서가 이 패키지로 보내고 있어 직접 짜면 추측이 된다. Meta 배포 npm 패키지(SAM License: 사용·수정·배포 허용, 배포 시 라이선스 사본 동봉, 출판물에 SAM 사용 표기). 서버에서만 쓰고 `licenses/SAM-LICENSE.txt`를 넣었다. 싫으시면 되돌린다.
- **SAM 사진 요청은 `stream: false`.** 근거: Meta 공개 레포 playground 서버 주석 「The SAM video Responses API answers a streaming image request with response.failed」. 영상은 Files API 업로드 후 스트리밍.
- **숫자 검사기.** 에이전트는 표에 등급·점수를 직접 쓰지 못하고 도구 결과 id(`call_N`)를 가리킨다. 글에는 숫자를 쓰지 못하고 `{call_N.field}` 자리표시만 쓸 수 있다. 위반하면 반려하고 이유를 돌려준다(최대 3번). 물체 이름 속 숫자(예: A4)는 숫자로 치지 않는다.
- **떨어질 확률 모형 = 반사 랜덤워크.** 하루 n번 밀리고 한 번에 표준편차 σ만큼 움직인다고 가정하면, T일 안에 여유 d를 넘을 확률 ≈ 2(1−Φ(d/(σ√(nT)))). 측정 몬테카를로 표본마다 계산해 평균. 장소 가정 3단계는 관리감독자가 고르고, 모두 「가정」으로 표에 남는다.
- **중대성 등급 경계 = 가정**, 다만 실제 보호구 시험 에너지에 맞춰 둠: 49 J(EN 397 산업용 안전모 정수리 충격, 5 kg 추) · 200 J(EN ISO 20345 안전화 앞코 충격). 다치는 정도를 말하지 않는다(의료 조언 금지).
- **사다리 기준 출처 확정**: OSHA 29 CFR 1926.1053(b)(5)(i) 「작업 길이의 약 1/4」(4:1, 약 75.96°). ±5° 허용 폭과 가능성 대응은 가정.
- **에이전트 없는 경로**: 같은 도구·같은 검사기로 고정 문장 표를 만든다. 키가 없을 때와, 에이전트 결과를 비교할 기준선으로 쓴다.
- **중력이 없는 사진**(업로드)은 사진 세로축을 수직으로 가정하고 σ = 3°로 둔다. 표에 「센서 측정 아님」으로 남는다.
- **호출 상한**: 서버 인스턴스 메모리 기준 하루 SAM 300회·Spark 400회, 기기당 분당 12회(환경 변수 `DAILY_SAM_CALL_CAP`·`DAILY_SPARK_CALL_CAP`로 조정). 전역 한도가 아니므로 Meta·Baseten 대시보드 한도가 최종 방어선.
- **import 확장자 `.js`**: Vercel Node 런타임은 api 파일을 하나씩 변환하므로 `.ts` 확장자 import는 실행 때 못 찾을 수 있다. `npm run check:api`로 같은 방식의 변환을 재현해 확인한다.
