# DemoCoffee 상품 옵션 레이아웃 API — 중앙 초안

> **초안이며 DemoCoffee의 실제 `options.v1` 전달 계약과 대조되지 않았다.**
> 아래 필드명, 그룹 ID, 해시 입력 문자열, 해시 산출 규칙, 기본 열 값은 중앙에서 제안한 값이다. DemoCoffee와 일치한다고 간주하거나 Production 계약으로 사용하면 안 된다.

## 근거와 범위

저장소에서 `options.v1` 문서나 구현을 찾지 못했다. 이 초안은 전달된 요구사항에 한정해 `democoffee` / `cafe.product-options` 화면에서 옵션 버튼 그룹의 열 수만 계획하도록 제안한다.

기존 엔드포인트와 인증 형식을 재사용한다.

- `POST /api/ai-layout/plan`
- `Authorization: Bearer <AI_LAYOUT_SERVICE_TOKEN>`
- 요청 본문은 별도 envelope 없이 최상위 모델 객체
- 메뉴 `menu.v2`와 별도 validator, policy, generator

## 초안 계약

- `schemaVersion`: `1`
- `hostId`: `democoffee`
- `screenId`: `cafe.product-options`
- `structureVersion`: `options.v1`
- 제안 그룹 ID: `options.selection-buttons`
- 제안 허용 operation: `setGroupColumns`만
- 제안 plan 필드: `schemaVersion`, `screenId`, `structureHash`, `constraintHash`, `viewportClass`, `operations`
- 제안 해시: 메뉴 계약과 같은 JavaScript `charCodeAt` 기반 FNV-1a; 제약 해시는 strict schema 파싱 후 필드 순서가 고정된 `JSON.stringify(constraints)`를 사용
- 현재 초안 구조 해시: `f808446c` (초안 구조 문자열에 한정; DemoCoffee 측 값과 일치 확인 전 사용 금지)

모델에는 옵션 값, 옵션명, 선택 상태 등 주문 정보가 포함되지 않는다. 모델은 옵션 항목·순서·이름·필수 여부·추가금, 수량, 장바구니, 주문·결제, 화면 이동을 보호 속성으로 선언한다. 유일한 mutable property는 제안 옵션 그룹의 `columns`다.

## 제안 접근성 정책

- `viewportClass=compact`: `[1]`, 기본 1열
- `regular` + 표준 글씨 + 표준 버튼: `[1,2]`, 기본 2열
- 큰 글씨 또는 큰 버튼: `[1]`, 기본 1열
- 허용되지 않은 열 수는 거부
- `viewportClass`는 호스트가 분류해 보내며, 중앙은 픽셀 너비를 독립 검증할 수 없다. 전달된 요구사항의 360px/390px 분류와 실제 호스트 임계값은 별도로 대조해야 한다.

## DemoCoffee와 대조가 필요한 항목

1. 실제 `groups` / `requiredIds` / `protectedProperties` 필드와 그룹 ID
2. `structureHash` 문자열 및 해시 알고리즘/값
3. `constraints`의 실제 필드, 순서, 기본 열 값, `constraintHash`
4. operation의 실제 이름·대상 ID·파라미터
5. `viewportClass` 분류 경계와 큰 글씨/버튼 제약이 전달되는 방식
6. 호스트가 최종 계획을 재검증하고 적용하는 정확한 규칙
7. 메뉴와 옵션 화면을 같은 ONE_SHOT 상태로 관리하는지 여부

중앙의 호스트별 ONE_SHOT 제한은 이 문서에서 변경하지 않는다. 메뉴 요청이 옵션 요청을 먼저 소비할 수 있는지는 DemoCoffee의 relay 상태 관리에 달려 있으며, 화면별로 분리할지 양쪽 계약을 확인해야 한다.
