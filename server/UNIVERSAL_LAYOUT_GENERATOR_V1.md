# Universal v1 단일 생성 파이프라인 설계

## 현재 구현 경계

- `universal-layout-generator.ts`는 contract model을 등록 정책으로 검증하고, 공통 system instruction·공통 structured-output schema를 provider에 전달한 뒤, 결과를 strict Zod plan schema와 기존 `validateUniversalLayoutPlan`으로 재검증한다.
- host/screen 별 생성 함수나 prompt는 없다. `democoffee/cafe.menu` 및 `civil.main-menu`는 `universal-layout-mock-policies.ts`의 데이터만 다르다.
- `POST /api/dev/universal-layout/plan`은 `NODE_ENV=development`이고 `UNIVERSAL_LAYOUT_DEV_MOCK_API=true`일 때만 등록된다. 기존 경로는 계속 `universalLayoutDevelopmentMockProvider`만 사용하며 각 component에서 허용된 첫 열 수를 반환하는 결정적 in-memory Mock이다.
- 실제 provider 어댑터는 공통 OpenAI Responses API 클라이언트 패턴을 사용하고 `store:false`, 18초 timeout, 자동 재시도 없음으로 구성된다. provider 입력에는 기존 추상 prompt payload와 strict JSON Schema만 전달되며, 반환은 strict Zod schema와 공통 정책 validator를 다시 통과해야 한다.
- OpenAI 경로는 별도 `POST /api/dev/universal-layout/openai-plan`이며, `NODE_ENV=development`, `UNIVERSAL_LAYOUT_DEV_MOCK_API=true`, `UNIVERSAL_LAYOUT_DEV_OPENAI_PROVIDER=true`가 모두 필요하다. 기본 OFF이며 기존 Mock API의 동작을 바꾸지 않는다. API 키가 없으면 provider 요청 전에 명시적으로 실패한다.
- OpenAI 경로도 기존 service Bearer 인증과 동일한 등록 정책을 적용한다. Production에서는 route가 등록되지 않는다. 테스트는 Fake provider만 주입하며 실제 OpenAI나 외부 API를 호출하지 않는다.
- route는 요청의 `model`을 strict schema로 확인하고, 등록된 host/screen인지 검사하며, 기존 service Bearer token으로 보호한다. 테스트 우회 헤더는 인정하지 않는다.
- 유효하지 않은 모델·JSON·plan은 명시적인 오류 코드로 거부한다. retry, 자동 수정, 기본 레이아웃 변경은 하지 않는다. 호출자는 오류 시 기존 화면을 그대로 유지해야 한다.
- Civil kiosk fixture는 확인된 벡터대로 320/360px compact `[1]`, 390px regular `[1, 2]`, 1080px wide `[1, 2]`를 허용한다. 큰 글씨·큰 버튼·고대비·하단 viewport에서는 `[1]`만 허용한다.
- 중앙 Universal v1 공통 구현으로 18개 안정 ID와 아홉 조건의 structure/constraint hash를 재계산해 첨부 golden vector와 일치함을 테스트한다. 이는 소스 구현 호환성 확인이며 중앙 API의 실제 배포·등록 확인은 아니다.
- Golden vector의 `bottomControls=true`는 schema field가 없고, 표준 regular 모델과 같은 accessibility 입력에서 별도 1열 정책을 선택한다. 그 1열 모델의 hash는 재현되지만 현재 중앙 registry의 표준 정책 검증은 이를 `COMPONENT_POLICY_MISMATCH`로 거부한다. 별도 contract 표현이나 안전한 좁힘 정책 결정이 필요하다.
- `civil-kiosk-mock` 및 `civil-main-mock.v1`은 fixture 값일 뿐 실제 호스트 등록값이 아니다.

## Provider 입력과 개인정보 경계

Provider 입력은 contract 식별자/해시, viewport, 제한된 접근성 선호, component ID/kind/role, 허용 열 수·작업, 최소 터치 크기, 보호 속성 이름으로 제한한다. itemCount, itemOrderHash, DOM/HTML, 상품·가격/이름, 주문/선택 값, 증명서·사용자 입력, QR 정보는 payload에서 제외한다. Provider 응답/요청 전체를 로그에 기록하지 않는다. 실제 AI 시험 전에는 사용자 승인과 OpenAI 처리·기본 abuse-monitoring 로그 보존에 대한 고지가 필요하다. `store:false`만으로 provider 측 보존이 전혀 없다고 약속하지 않는다.

## 실제 AI 시험을 위한 명시적 활성화

OpenAI 요청은 현재 코드 경로를 호출하지 않는 한 발생하지 않는다. 개발 시험 전에는 해당 Development 프로세스에서 `UNIVERSAL_LAYOUT_DEV_OPENAI_PROVIDER=true`를 명시하고, 기존 Secrets 관리에 API 키가 준비되어 있어야 한다. 승인 후 별도 시험에서만 AI 전용 경로를 사용하며, 일반 Mock 경로는 계속 Mock 결과를 반환한다. Production 플래그 활성화 경로는 제공하지 않는다.

## 공통 schema와 최종 검증

`createUniversalLayoutPlanJsonSchema`는 같은 구조의 strict JSON Schema를 생성한다. 모델별 상수 식별자와 component별 `allowedColumns` enum만 등록 policy에서 주입한다. Schema는 추가 속성과 잘못된 열 값을 제한하며, Zod strict schema가 형식을 다시 검사한다. 중복 target 및 등록 policy/hash 일치 여부는 최종 `validateUniversalLayoutPlan`이 독립적으로 검사한다. 따라서 structured output schema는 방어의 한 층이고 최종 validator를 대체하지 않는다.

## 요청 lifecycle 제안 (아직 UI·중복 관리에 미연결)

1. 화면이 활성화될 때 해당 host/screen/model fingerprint당 ONE_SHOT 요청만 시작한다. fingerprint에는 `hostId`, `screenId`, `contractVersion`, `structureVersion`, `structureHash`, `constraintHash`, `viewportClass`가 들어간다. 접근성은 constraint hash와 함께 묶인다.
2. 같은 fingerprint의 in-flight 호출은 중복 생성하지 않고 기존 Promise에 합류한다. 성공 plan만 검증 완료 후 짧은 기간(기존 central route의 30초 cache와 동일한 TTL) fingerprint 키로 보관한다. 실패 결과를 유효한 계획처럼 캐시하지 않는다.
3. 화면 전환/컴포넌트 unmount 시 `AbortController`를 사용한다. Provider가 중단을 무시하고 늦게 반환하더라도 pipeline은 취소 상태를 확인하고 plan을 버린다. 호출자는 fingerprint를 다시 확인해 stale 결과를 적용하지 않는다.
4. screen별 ONE_SHOT 제한과 별도로 기존 central host-wide request budget을 유지한다. 현재 Development Mock route는 기존 `layoutAttempts`나 `layoutPlanCache`를 참조하지 않으므로 그 호출 횟수 상태를 소비하지 않는다. UI의 명시적 재시도 정책은 현재 adapter 승인 전에 확정하지 않는다.
5. Diagnostic은 random request ID, controlled stage, status/error code, provider-call/timeout boolean만 허용한다. prompt, model, plan, credentials, 토큰 포함 URL은 기록하지 않는다.

이 lifecycle의 중복 요청 병합·성공 캐시·화면 전환 취소는 아직 Development Mock route나 UI에 구현되지 않았다. 기존 menu.v2/options.v1 route의 cache/rate-limit 및 DemoCoffee ONE_SHOT은 변경하지 않았다.
