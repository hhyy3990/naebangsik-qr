# Universal v1 단일 생성 파이프라인 설계

## 현재 구현 경계

- `universal-layout-generator.ts`는 contract model을 등록 정책으로 검증하고, 공통 system instruction·공통 structured-output schema를 provider에 전달한 뒤, 결과를 strict Zod plan schema와 기존 `validateUniversalLayoutPlan`으로 재검증한다.
- host/screen 별 생성 함수나 prompt는 없다. `democoffee/cafe.menu` 및 `civil.main-menu`는 `universal-layout-mock-policies.ts`의 데이터만 다르다.
- provider는 주입 인터페이스다. 이 변경은 Mock 테스트만 사용하며 OpenAI adapter, API route, `server/app.ts`는 연결하지 않는다.
- 유효하지 않은 모델·JSON·plan은 명시적인 오류 코드로 거부한다. retry, 자동 수정, 기본 레이아웃 변경은 하지 않는다. 호출자는 오류 시 기존 화면을 그대로 유지해야 한다.

## Provider 입력과 개인정보 경계

Provider 입력은 contract 식별자/해시, viewport, 제한된 접근성 선호, component ID/kind/role, 허용 열 수·작업, 최소 터치 크기, 보호 속성 이름으로 제한한다. itemCount, itemOrderHash, item IDs, DOM/HTML, 상품·가격·주문/선택 값, 증명서·사용자 입력, QR 정보는 payload에서 제외한다. Provider 응답/요청 전체를 로그에 기록하지 않는다.

## 공통 schema와 최종 검증

`createUniversalLayoutPlanJsonSchema`는 같은 구조의 strict JSON Schema를 생성한다. 모델별 상수 식별자와 component별 `allowedColumns` enum만 등록 policy에서 주입한다. Schema는 추가 속성과 잘못된 열 값을 제한하며, Zod strict schema가 형식을 다시 검사한다. 중복 target 및 등록 policy/hash 일치 여부는 최종 `validateUniversalLayoutPlan`이 독립적으로 검사한다. 따라서 structured output schema는 방어의 한 층이고 최종 validator를 대체하지 않는다.

## 요청 lifecycle 제안 (아직 route/UI에 미연결)

1. 화면이 활성화될 때 해당 host/screen/model fingerprint당 ONE_SHOT 요청만 시작한다. fingerprint에는 `hostId`, `screenId`, `contractVersion`, `structureVersion`, `structureHash`, `constraintHash`, `viewportClass`가 들어간다. 접근성은 constraint hash와 함께 묶인다.
2. 같은 fingerprint의 in-flight 호출은 중복 생성하지 않고 기존 Promise에 합류한다. 성공 plan만 검증 완료 후 짧은 기간(기존 central route의 30초 cache와 동일한 TTL) fingerprint 키로 보관한다. 실패 결과를 유효한 계획처럼 캐시하지 않는다.
3. 화면 전환/컴포넌트 unmount 시 `AbortController`를 사용한다. Provider가 중단을 무시하고 늦게 반환하더라도 pipeline은 취소 상태를 확인하고 plan을 버린다. 호출자는 fingerprint를 다시 확인해 stale 결과를 적용하지 않는다.
4. screen별 ONE_SHOT 제한과 별도로 기존 central host-wide request budget을 유지한다. 이번 변경은 해당 budget이나 route를 수정하지 않는다. UI의 명시적 재시도 정책은 현재 adapter 승인 전에 확정하지 않는다.
5. Diagnostic은 random request ID, controlled stage, status/error code, provider-call/timeout boolean만 허용한다. prompt, model, plan, credentials, 토큰 포함 URL은 기록하지 않는다.

이 lifecycle은 구현 제안일 뿐이며, 기존 `server/app.ts` cache/rate-limit, DemoCoffee ONE_SHOT, 서비스 API에는 아직 적용되지 않았다.
