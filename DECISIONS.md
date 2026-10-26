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
