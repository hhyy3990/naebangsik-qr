# Universal Layout Contract v1 — 설계 초안

> **상태: 설계 초안.** 데모커피의 `menu.v2`는 중앙과 호스트가 사용한 실제 계약 근거가 있으나, 중앙의 `options.v1`은 데모커피와 대조되지 않은 초안이다. 무인민원발급기 화면 구조는 이 저장소에서 확인할 수 없다. 아래의 범용 스키마와 무인민원발급기 매핑은 제안이며, 확인된 구현 사실로 취급하면 안 된다.

## 1. 목표와 경계

Universal Layout Contract는 호스트가 제공한 제한된 UI 구조와 제약에 대해 중앙이 허용된 배치 작업만 선택하고, 중앙과 호스트가 같은 규칙으로 계획을 검증할 수 있게 하는 버전 계약이다.

- 목표는 명시적으로 연결된 키오스크 화면의 레이아웃을 조정하는 것이다. 임의 웹사이트 자동 수정은 목표가 아니다.
- AI는 화면 내용이나 코드가 아닌 허용된 구성 요소 ID와 배치 작업만 반환한다.
- 서버는 요청 모델과 AI 계획을 검증한다. 실제 UI 적용과 최종 적용 직전의 현재 화면 검증은 호스트 책임이다.
- 주문·결제·선택 상태·입력값 등 사업 데이터와 개인정보는 모델에 포함하지 않는다.
- v1은 중앙과 호스트 어댑터가 각자 검증할 수 있는 데이터 계약으로 시작한다. 전용 서버 프롬프트나 검증기를 화면마다 만드는 구조를 목표로 하지 않는다.

## 2. 저장소에서 확인한 사실과 미확인 사항

### 중앙 소스에서 확인한 사실

- `menu.v2`는 `server/demo-menu-layout.ts`의 전용 모델·정책·생성기·validator를 사용한다. `democoffee` / `cafe.menu`, structure hash `837f86b3`, FNV-1a, 열 수·카드 흐름·이미지 basis 작업을 검증한다.
- 메뉴 계약은 `setGroupFlow`와 `setChildBasis`를 함께 요구하고, 카드 내부 작업이 있으면 유효 열 수가 1이어야 한다. 기본 열 수가 적용되는 생략 경우도 검사한다.
- `options.v1`은 이 초안 작성 시점의 중앙 `server/demo-options-layout.ts`에 별도로 구현돼 있다. 그룹 ID `options.selection-buttons`, structure hash `f808446c`, FNV-1a 및 필드 이름은 중앙이 제안한 값이며 데모커피와 대조되지 않았다.
- 두 전용 엔진은 `/api/ai-layout/plan`을 공유하지만 별도 정책·생성기·검증기를 가진다. 이외의 legacy generic layout 경로도 `server/layout-plan.ts`에 존재한다.
- 프로필 선호는 `src/lib/profile.ts`에서 v5 타입으로 표현된다. 텍스트 크기, 버튼 크기, 대비, 뷰포트 모드 등은 프로필 데이터이며 화면 구조 계약과는 별도다.
- 중앙 저장소의 `package.json`과 `src/`에서 `@naebangsik/kiosk-accessibility-sdk`의 구현 또는 사용처를 찾지 못했다. SDK v0.5.31 정보는 전달된 프로젝트 설명에서 온 것이며 이 저장소로 구현 동작을 검증한 사실은 아니다.

### 아직 확인되지 않은 사항

- 데모커피 옵션의 실제 그룹 ID, 필드/operation 이름, 구조·제약 해시 입력 및 값, viewport 분류 경계, 호스트 적용 시점의 정확한 재검증 방식.
- 무인민원발급기의 실제 화면, UI 구성 요소, 접근성 정책, 동작 및 호스트 어댑터.
- SDK의 실제 공개 API, 화면 구조 수집 능력, 계획 적용 책임 및 버전 간 호환성.
- 메뉴와 옵션 요청이 DemoCoffee relay의 동일 ONE_SHOT 상태를 공유하는지.
- 일반적인 화면 어댑터가 키오스크별 네이티브/웹 UI에서 어떤 공통 추상화를 사용할 수 있는지.

## 3. 범용 구성 요소 v1 후보

초기 범위는 기존 근거가 있거나 화면 연결 시 검증 가능한 구성 요소로 제한한다.

| Component kind | 역할 | 허용 변경의 예 | 보호할 항목 |
|---|---|---|---|
| `choice-grid` | 반복되는 선택 항목 또는 옵션 버튼 모음 | 열 수, 정책이 허용하는 간격 | 항목 ID·내용·순서·선택 상태·필수 여부·가격·선택 동작 |
| `repeated-card-list` | 이미지·정보·동작 슬롯을 가진 반복 항목 | 열 수, 카드 내부 흐름, 미디어 basis | 상품/서비스 데이터, 항목 순서, 가격, 주요 동작 |
| `input-group` | 입력 컨트롤과 설명의 그룹 | 배치 방향·간격 등 명시적으로 등록된 레이아웃만 | 필드 종류·라벨·필수 조건·입력값·검증·제출 동작 |
| `information-region` | 안내·정보 콘텐츠 영역 | 순서를 유지하는 흐름·간격 | 텍스트 내용, 우선순위, 접근 가능한 이름 |
| `summary-region` | 확인 단계의 요약 영역 | 반응형 흐름·간격 | 요약 데이터, 계산 결과, 편집/확정 동작 |
| `action-region` | 주요/보조 실행 버튼 영역 | 허용되는 정렬·간격 | 버튼 의미, 순서, 결제·발급 등 동작 |

v1 최초 구현은 `choice-grid`와 `repeated-card-list`에 한정하는 것을 권장한다. 다른 후보는 실제 두 호스트의 화면 구조와 안전한 작업을 검토한 뒤 추가한다. 이 표는 무인민원발급기 구현 사실을 뜻하지 않는다.

각 구성 요소는 안정적 ID, 의미 역할, 정렬 순서, 허용 operation, 허용값/범위, 최소 터치 영역, 접근성 제약 및 보호 속성을 제공한다. 구조 응답에는 실제 label, 옵션 값, 입력값, HTML 또는 전체 DOM을 싣지 않는다.

## 4. Universal Layout Contract v1 모델 초안

다음은 필드명과 세부 표현이 아직 제안 단계인 구조 예시다. 실제 호스트 계약과 합의한 뒤 확정해야 한다.

```json
{
  "schemaVersion": 1,
  "contractVersion": "universal-layout.v1",
  "hostId": "example-host",
  "screenId": "screen.example",
  "structureVersion": "screen-structure.v1",
  "structureHash": "<canonical structure digest>",
  "constraintHash": "<canonical constraints digest>",
  "viewportClass": "regular",
  "accessibility": {
    "textScale": "standard",
    "buttonScale": "standard",
    "contrast": "standard",
    "viewportMode": null
  },
  "components": [
    {
      "id": "stable.component-id",
      "kind": "choice-grid",
      "role": "option-button-group",
      "order": 0,
      "capabilities": {
        "operations": ["setColumns"],
        "allowedColumns": [1, 2],
        "minimumTouchTargetPx": 44
      },
      "protectedProperties": ["items", "order", "selection"]
    }
  ],
  "constraints": {
    "allowedOperations": ["setColumns"],
    "protectedProperties": ["business-data", "selection-state"],
    "preserveComponentOrder": true
  }
}
```

계획은 요청의 schema/contract version, host/screen, structure/constraint hash 및 viewport class를 그대로 되돌려야 한다. 예시 operation은 다음처럼 허용된 구성 요소와 값만 참조한다.

```json
{
  "schemaVersion": 1,
  "contractVersion": "universal-layout.v1",
  "hostId": "example-host",
  "screenId": "screen.example",
  "structureHash": "<same request digest>",
  "constraintHash": "<same request digest>",
  "viewportClass": "regular",
  "operations": [
    {
      "type": "setColumns",
      "targetId": "stable.component-id",
      "columns": 2
    }
  ]
}
```

`reason`, 자유 텍스트, 코드, 사용자 설명은 v1 plan에 넣지 않는다. 설명이 필요하다면 민감 정보가 없는 제한된 enum 코드만 별도 버전에서 검토한다.

### 버전과 해시

- `schemaVersion`은 직렬화된 envelope의 버전, `contractVersion`은 공통 UI 의미/operation 의미의 버전, `structureVersion`은 호스트가 제공하는 특정 화면 구조의 버전으로 분리한다.
- `structureHash`는 의미 있는 안정 ID, kind, role, order, capabilities 및 구조 버전을 정규화한 뒤 계산한다. 화면 데이터와 접근성 프로필 값은 포함하지 않는다.
- `constraintHash`는 허용 operation/대상/범위, 접근성에 따른 허용 집합, 보호 규칙을 정규화해 계산한다.
- 권장 초안은 고정 규칙의 JSON canonicalization 후 SHA-256이다. 배열 정렬 규칙, null 처리, Unicode 정규화, 숫자 표현 및 필드 제외 규칙을 양쪽 테스트 벡터로 합의하기 전에는 구현 계약으로 확정하지 않는다.
- 구조, capability, 제약 또는 operation 의미가 바뀌면 대응 hash/version을 바꿔 이전 plan을 거부한다. 호스트는 계획을 적용하기 직전에 현재 해시를 다시 비교한다.
- 기존 메뉴와 옵션의 FNV-1a 값은 기존 계약에서만 유효하다. Universal v1의 해시로 재해석하거나 그대로 재사용하지 않는다.

## 5. 공통 operation 및 검증 정책

### 공통 operation 초안

초기 canonical operation은 다음과 같이 최소화한다.

- `setColumns`: 대상 component가 허용하는 정수 열 수만 설정.
- `setFlow`: 대상 그룹의 `row`/`column` 방향 중 등록된 방향만 설정.
- `setGap`: 호스트 정책에 등록된 토큰 또는 bounded 값만 설정.
- `setChildBasis`: 등록된 자식의 허용 범위 안에서만 크기 비율 설정.
- 이후 실제 필요가 확인되면 정렬·미디어 위치·공간 비율을 별도 capability로 추가한다.

호스트별 adapter가 레거시 operation 이름을 canonical action으로 매핑한다. 없는 항목이나 작업은 지원하는 것으로 추정하지 않는다. 입력값 변경·요소 생성/삭제/재정렬·탐색 변경·결제 변경 operation은 v1 범위에 넣지 않는다.

### 검증 순서

1. JSON 크기 제한과 strict schema 검사.
2. host, screen, schema/contract/structure version 및 등록된 adapter 확인.
3. canonical structure/constraint 재계산 및 전달 hash 비교.
4. component ID·kind·role·capabilities·필수 요소를 서버 정책과 비교.
5. operation 대상, 허용 타입, 범위, 중복 및 순서 검사.
6. 접근성 제약, minimum touch target, viewport/사용 가능 영역 및 작업 조합 검사.
7. plan의 모든 식별자·버전·hash·viewport가 요청과 일치하는지 검사.
8. 검증 실패는 명시적 오류로 반환한다. AI 출력에 맞추어 서버 검증을 약화하거나, 무음 보정·대체 계획으로 바꾸지 않는다.
9. 호스트는 수신 시점에도 현재 화면·상태를 재검증하고 불일치하면 기존 레이아웃을 유지한다.

호스트 정책과 operation 정의가 OpenAI JSON Schema와 서버 validator에서 각각 복제되지 않도록, 하나의 typed policy registry에서 허용 대상·enum·범위·조합을 도출하는 방향을 권장한다. 계획 validator는 생성 프롬프트와 독립된 보안 경계로 유지한다.

### 접근성

- QR 프로필 v5의 전체 원문을 전송하지 않고, layout policy에 필요한 최소 선호만 coarse value로 정규화한다.
- 해당 화면에서 검증된 조건에 따라 허용 열 수를 서버가 계산한다. 호스트 분류(viewportClass/availableArea)와 픽셀 임계값은 명시적으로 합의한다.
- 큰 글씨/버튼, 고대비, 하단 뷰포트 등 조합의 안전 결과가 확인되지 않으면 보수적으로 plan을 거부하거나 보수적 capability를 전달한다. 프로필 전체를 AI에게 보내지 않는다.

## 6. 기존 계약에 대한 매핑 예시

| 기존 항목 | menu.v2 현재 계약 | options.v1 중앙 초안 | Universal v1 제안 |
|---|---|---|---|
| 호스트/화면 | `democoffee` / `cafe.menu` | `democoffee` / `cafe.product-options` | `hostId` + `screenId` + adapter 등록 |
| 구성 요소 | product list/card/information | `options.selection-buttons` 초안 그룹 | `choice-grid`, `repeated-card-list` |
| 열 작업 | `setGroupColumns` | `setGroupColumns` 초안 | canonical `setColumns` |
| 추가 작업 | paired `setGroupFlow` + `setChildBasis` | 없음 | capability가 명시된 경우에만 canonical `setFlow` + `setChildBasis` |
| 제약 | compact/큰 글씨/큰 버튼은 1열; regular 표준은 1/2열 | 중앙 초안의 유사 정책, 호스트 미대조 | 정규화된 accessibility + component capabilities + host policy |
| 해시 | 고정 구조의 FNV-1a | 초안 고정 구조의 FNV-1a | 새 canonical digest 제안, 합의 전 미확정 |
| plan 검증 | 전용 Zod validator | 전용 Zod validator | 공통 validator + 버전별 compatibility adapter 후보 |

이는 즉시 변환 가능한 계약이라는 뜻이 아니다. 기존 menu.v2의 FNV-1a 기반 값과 새 제안의 canonical digest는 다르며, adapter·shadow validator·호스트 테스트 없이 기존 plan이나 캐시를 Universal v1로 해석하면 안 된다.

## 7. 키오스크별 후보 매핑과 개인정보

### DemoCoffee

- **상품 메뉴:** 확인된 menu.v2 모델을 `repeated-card-list` 후보에 매핑. 기존 구조 hash, allowed operations 및 호스트 plan validator를 기준으로 adapter를 합의한다.
- **상품 옵션 선택:** `choice-grid` 후보. 중앙 options.v1의 group ID/hash/필드/기본 열은 미확정 초안이다. DemoCoffee의 실제 계약 문서나 모델 테스트 벡터가 오기 전에는 확정 매핑으로 사용할 수 없다.
- **장바구니:** 사용자 요청은 화면 후보만 제시한다. 이 저장소에서 장바구니 UI와 안전하게 조절 가능한 배치 작업을 확인하지 못했으므로 매핑은 미정이다. 품목·수량·가격·합계·주문 상태는 AI 모델에 넣지 않는다.

### 무인민원발급기

전달된 후보 화면 이름만 기준으로 한 검토용 가설이다. 실제 장비 소스나 계약은 확인하지 못했다.

- 민원 종류 선택 → `choice-grid` 후보
- 증명서 옵션 선택 → `choice-grid` 후보
- 신청 정보 입력 → `input-group` 후보. 주민등록번호, 이름, 주소, 입력값, 검증 오류 및 인증 데이터는 모델에 포함하지 않는다.
- 발급 내용 확인 → `summary-region` 후보. 실제 증명 데이터와 발급 내용을 모델에 보내지 않는다.
- 발급/결제/확인 버튼은 action 의미와 순서를 보호하며 레이아웃 작업이 그 동작을 바꾸지 않게 한다.

각 후보는 장비 담당자 검토, 화면 구조/접근성 테스트, 보안 검토 전까지 구현 규격이 아니다.

## 8. SDK와 중앙 서버 책임

### 호스트와 접근성 SDK

- 기존 QR 프로필 조회·캐시·접근성 적용 책임과 레이아웃 plan 책임을 구분한다.
- 프로필을 host-specific layout capability로 매핑하고 안전한 구조 요약을 만드는 인터페이스를 검토한다.
- 적용 직전 `screenId`, structure hash, constraint hash, 대상 ID 및 현재 화면 상태를 확인한다.
- 검증된 operation만 기존 DOM/컴포넌트 adapter로 적용하고, 실패·화면 변경 시 원래 레이아웃을 유지한다.
- 주문·결제·선택·폼 입력 동작을 포함한 사업 로직은 SDK/host가 보존한다. AI plan은 business state를 수정할 권한이 없다.
- 서비스 토큰, OpenAI 키, 사용자 입력값을 SDK/browser에 넣지 않는다.

### 중앙 서버

- 정책 registry, strict request validation, AI 호출, common plan validation, rate limit, 제한된 진단을 담당한다.
- 호스트 renderer, 실제 DOM 적용, 프로필 저장/수정, QR 인증 토큰을 다루지 않는다.
- 오류 본문과 로그에는 request ID 및 제한된 오류 코드만 사용하고 요청 본문/사용자 데이터를 기록하지 않는다.
- 서로 다른 Replit 프로젝트의 Development 호출은 서비스 인증 및 Replit Development 보호 인증이 겹칠 수 있다. 이 설계는 이중 인증 전달 방법을 해결하지 않으며, 인증을 합치거나 우회하지 않는다.

SDK v0.5.31은 요청 설명에 기재된 버전이다. 중앙 저장소에 SDK 의존성과 구현이 없으므로, 실제 public API나 기존 SDK 적용 동작은 별도 저장소에서 확인해야 한다.

## 9. 중복·차이와 공통화 경계

중앙 menu.v2와 options.v1은 strict parse, 구조화 JSON 응답, hash echo, operation allowlist, plan 재검증, OpenAI Responses 호출, no-store, timeout, 30초 cache 및 공통 API 오류 경로를 가진다. 반면 모델 형식, hash, 구조, operation semantics, 접근성 조합은 다르다.

권장 공통화 단위:

- versioned envelope와 canonical hash 유틸리티
- policy registry의 typed capability/target/range 정의
- policy에서 plan JSON Schema를 구성하는 helper
- strict response parse + echo 검증 + 제한된 diagnostics
- 캐시 키 생성과 오류 mapping

호스트 고유의 모델을 하나의 큰 union validator로 강제하거나, operation 의미를 문자열 이름만으로 합치지 않는다. 기존 v2/v1 validator는 compatibility adapter가 동등한 거부 동작을 입증할 때까지 source of truth로 유지한다. 특히 `CARD_LAYOUT_REQUIRES_SINGLE_COLUMN` 같은 조건부 작업 조합은 공통 capability 정책에서 AI schema와 최종 validator 양쪽에 일관되게 반영하되, 최종 validator를 완화하지 않는다.

기존 현재 캐시는 요청 입력 전체의 JSON hash와 프로세스별 30초 만료를 사용한다. Universal v1에서는 canonical normalized request와 contract/policy/model 버전을 키에 포함하고, 개인정보·가변 화면 데이터를 캐시 키나 로그에 불필요하게 포함하지 않는 방안을 설계 단계에서 검증한다. 다중 인스턴스 전역 중복 제거는 별도 운영 결정이다.

## 10. 단계적 전환 계획

1. **계약 확인:** DemoCoffee 메뉴/옵션 계약과 무인민원발급기 화면 담당자로부터 실제 모델/해시/작업·접근성 테스트 벡터를 받는다. ONE_SHOT의 화면별 의미도 DemoCoffee와 확인한다.
2. **명세 고정:** canonical component/operation, 정규화/hash, 오류 코드, 개인정보 필드 거부 조건을 버전 관리되는 스키마와 예제로 확정한다.
3. **순수 공통 검증:** 기존 서비스 route와 생성기를 건드리지 않고 pure validator/hash/schema 생성기 및 합의된 golden vectors를 추가한다.
4. **shadow 비교:** menu.v2/options.v1 요청을 Universal v1로 변환해 결과를 적용하지 않고 기존 validator와 비교한다. 허용·거부 결과가 다르면 전환하지 않는다.
5. **호스트 adapter 검증:** DemoCoffee 한 화면에서 Mock만 적용해 plan round-trip, 접근성 조건, stale 화면 취소, business behavior 불변을 확인한다.
6. **별도 opt-in Development 경로:** 명시적 사용자 승인을 받은 뒤 새 버전만 Development에서 시험한다. 구버전 endpoint·validator와 Production을 그대로 둔다.
7. **두 번째 호스트 적용 후보:** 무인민원발급기 담당자가 실제 화면/PII 경계/안전 테스트 벡터를 제공한 뒤 별도 adapter로 검증한다.
8. **호환성 결정:** 여러 호스트의 수용 기준과 롤백 경로를 통과한 뒤에만 별도 승인으로 운영 전환/SDK 변화 여부를 결정한다. 이번 설계 단계에서는 삭제·교체·배포하지 않는다.

## 11. 수용 기준

- 승인된 구조만 strict schema로 받아들이고 미등록 host/screen/component/operation은 거부한다.
- 구조·제약 또는 버전 불일치 plan은 적용되지 않는다.
- 허용값·작업 조합·접근성 제약을 벗어난 plan은 명시적으로 거부되며 server validator가 완화되지 않는다.
- 모델/plan에 DOM, 코드, 개인 식별정보, 입력값, 옵션 값, 선택 상태, 주문/결제 데이터가 들어가지 않는 것을 golden test로 확인한다.
- 호스트의 자체 validator와 adapter는 실패, stale hash, 화면 전환에서 기존 레이아웃과 사업 동작을 유지한다.
- 메뉴 v2 및 옵션 v1에서 기존에 거부하던 경우를 Universal validator가 조용히 승인하지 않는다.
- 합의된 각 host의 최소 한 가지 1열·2열 성공 벡터와 각 접근성/미등록 작업 거부 벡터를 CI Mock으로 재현한다.
- universal engine을 추가해도 old/new cache key와 contract version이 충돌하지 않는다.
- 무인민원발급기에서는 실제 개인정보가 전송되지 않음을 privacy test로 확인한다.

## 12. 이번 단계의 변경 범위

이 문서는 설계 초안이며 구현 변경이 아니다. Universal v1 설계를 위해 서비스 route, AI 생성기, 기존 validator, DB, QR, SDK, 데모커피 및 무인민원발급기 코드를 수정하지 않는다. 실제 OpenAI 호출, AI 계획 API 요청, Production 변경·배포도 하지 않는다.
