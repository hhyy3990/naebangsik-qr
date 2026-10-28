# Universal Layout Contract v2 — 범용 레이아웃 설계안

**Status:** 설계안 및 local prototype. v2는 `setColumns`, `reserved-bottom-controls`, policy-owned option group 선언/접근성·capability 필터/해시 검증과 내부 option 선택 검증을 제공한다. 새 AI plan operation과 실제 preset 적용은 아직 제안 상태다. API route, provider, host, SDK, cache, Production 통합은 없다. 모든 AI 관련 스위치는 OFF로 유지한다.

## Why v2 is separate

Universal v1 expresses user accessibility preferences (`textScale`, `buttonScale`, `contrast`, `viewportMode`) and registry-resolved `allowedColumns`. It has no field for other layout conditions such as persistent controls reserving the bottom edge. The v1 registry therefore correctly rejects a regular model that claims `[1]` when its registered policy calculates `[1, 2]`.

Do not weaken that equality check or modify v1 hashes. A v1 payload cannot carry this state without changing its strict wire schema and hash inputs.

## Proposed v2 field

```ts
layoutCapabilities: ["reserved-bottom-controls"]
```

This is a small, extensible set of registered layout conditions, distinct from a user preference or a host-supplied column count. `reserved-bottom-controls` means that the host has positively determined that active, persistent UI reserves usable screen space along the bottom edge, and that content governed by the registered policy must not be laid out as if that space were available. It is not a control's preference flag and is not merely a claim that a footer element exists in the DOM.

The capability's presence is an assertion about current layout state. Its absence means only “not asserted”; it is not evidence that no fixed footer, navigation, or other bottom UI exists. The current prototype interprets absence as no additional capability-based restriction, so a production host must not send an empty capability list when detection is unknown or incomplete if that could permit an unsafe layout. In that case the host should withhold AI layout application and use its safe non-AI layout until it can determine the state.

The capability is generic across kiosks. It can describe a fixed control bar, bottom navigation, or any other persistent UI that reduces the usable content area or creates a no-overlap region. Its name and v2 wire representation remain unchanged in this prototype. The one-column effect below is a registry policy choice for the affected component, not an inherent rule that every bottom reservation universally requires one column.

Each host/screen policy declares:

- which capabilities it permits;
- which registered component(s) each capability affects;
- the maximum permitted columns for those components.

The central resolver starts with the registered viewport/accessibility columns and applies the capability rules. It then compares the submitted `allowedColumns` against that derived result. Unknown, duplicate, unsupported, or misconfigured capabilities are rejected. The caller cannot widen or narrow the resolved set by editing `allowedColumns`.

The local prototype registers `reserved-bottom-controls` for the civil fixture and limits its certificate grid to one column. It does not register this capability for DemoCoffee. These are mock policies, not approval of either real host's policy.

## v2 fields and hashes

v2 retains the v1 model and plan fields, with `schemaVersion: 2`, `contractVersion: "universal-layout.v2"`, and required `layoutCapabilities`.

- **Structure hash:** SHA-256 over canonical JSON containing schema/contract version, host, screen, structure version, and ordered component identity/state including `itemCount` and `itemOrderHash`.
- **Constraint hash:** SHA-256 over canonical JSON containing schema/contract version, viewport, accessibility summary, sorted `layoutCapabilities`, allowed operations, and registry-resolved component constraints including `allowedColumns`.
- v1 continues to use its existing hash input unchanged. v2 explicitly namespaces both hashes with its schema and contract versions.

The prototype reuses the v1 canonical JSON/SHA-256 primitive, but has independent v2 model and plan schemas, policy resolution, and validators. It is not wired to the v1 generator or route.

## Compatibility and cache isolation

- v1 requests and plans remain accepted only by the v1 schema and validator.
- v2 requests and plans are accepted only by the v2 schema and validator.
- Cross-version model/plan use fails strict schema validation.
- Any future cache must include schema version, contract version, host, screen, structure version/hash, and constraint hash in its key. No cache was added or changed in this prototype.
- The current generator is typed to v1 model/plan types and calls the v1 validator; it cannot safely be reused as-is. A future integration should extract only the provider transport/orchestration after contract selection, while keeping each version's strict schema and final validator separate.

## Host and trust boundary

The capability is a host-reported runtime condition. Central validation can ensure that the capability is registered and that its policy-derived effect is enforced; it cannot independently inspect the kiosk DOM or prove the host reported the physical layout correctly. User preference and actual reserved space are separate: for example, `bottomControls: false` does not imply that no footer is fixed, and `bottomControls: true` alone does not prove that it occupies space in the current viewport. Likewise, viewport mode is an independent accessibility setting and must not be used as a proxy for this capability.

The host adapter must derive the capability from its actual screen state, and the host must validate the returned plan again. No universal CSS measurement rule is established yet. Before a real host can safely assert this capability, it needs a documented measurement/state rule covering at least:

- whether the control region is currently visible, enabled, and fixed/sticky for the active screen;
- its rendered bounding rectangle relative to the visual/layout viewport, including bottom edge and overlap with the content region;
- the usable content rectangle after safe-area insets and reserved controls, plus viewport dimensions and orientation;
- changes caused by resize, orientation, zoom, keyboard/overlay appearance, responsive breakpoints, or controls being added/removed;
- the threshold and rounding rule for deciding that a non-zero region is reserved, and how unknown/measurement failure is handled.

Possible browser inputs include `getBoundingClientRect()`, viewport dimensions, safe-area insets, and resize/layout observation, but these are candidates for host implementation—not a prescribed or browser-tested algorithm in this draft.

Any capability addition/removal changes the constraint hash. A plan produced for the previous state must therefore be rejected against the new model. A host must also cancel or ignore already-issued stale plans when the measured state changes.

The requested SDK v0.5.31 and kiosk host source were not present in this workspace. Only a v0.5.28 SDK archive was attached. Therefore this prototype does not claim that v0.5.31 exposes the required state or that either real host currently sends it.

## Mock verification

`server/universal-layout-contract-v2.test.ts` covers:

- normal civil fixture: 1- and 2-column plans accepted;
- registered `reserved-bottom-controls`: 1-column accepted, 2-column rejected;
- no capability asserted: the mock registry applies no capability-specific restriction; this does not prove the physical absence of bottom UI;
- capability asserted for a persistent reserved area regardless of the user's preference value: policy limits the registered component to one column;
- viewport-mode accessibility restriction without the capability: any one-column result comes from the independent accessibility policy, not from an inferred bottom-control capability;
- capability appearance/removal: constraint hashes change, and a plan from the old model is rejected;
- unknown and cross-host capabilities rejected;
- caller-edited column sets and hash mismatches rejected;
- cross-host plans rejected;
- v1-shaped models/plans rejected by v2 validation;
- policy-owned option groups are filtered by capability/accessibility, hash-bound, and validated by an internal selector without adding a wire-level AI operation;
- unapproved plan operation names and duplicate targets are rejected.

These are pure policy/validator mocks. They do not measure CSS, establish a real host's detection algorithm, or prove that a particular SDK preference matches physical layout.

The v2 module and these tests are local-only. No OpenAI call, central API request, Production deployment, host/SDK change, or v1 behavior change is part of this draft.

## Host synchronization before integration

Before registering or using v2 in a service:

1. Confirm the real host ID, screen, structure version, and whether the SDK exposes the persistent-control state.
2. Implement host-side capability detection from actual layout state; do not infer the capability from a user profile preference alone. Treat unknown detection as unsafe for AI layout application rather than assuming no reserved area.
3. Have both sides use the same v2 schema, capability registry, canonicalization, hash inputs, and golden vectors.
4. Keep v1 clients on v1 and v2 clients on v2; do not silently reinterpret v1 requests.
5. Add an explicitly gated Development API/provider integration only after host conformance tests pass.

No Production identity or capability policy is approved by this draft.

## 범용 v2 확장 제안

현재 prototype의 strict schema, 별도 v2 hash namespace, 등록 정책 기반 model 재구성, capability 효과를 반영한 검증은 유지한다. policy-owned option group 선언, accessibility/capability 조건에 따른 option 목록 필터링, constraint hash 결속, 내부 option ID 검증 기반은 local로 구현되어 있다. 이는 새 AI plan operation이나 CSS 적용을 지원하지 않는다. 나머지 확장안은 구현 전 승인을 위한 설계다. 업종별 prompt 대신 모든 화면에 같은 operation semantics와 공통 validator를 적용하고, 화면별 차이는 등록된 host/screen policy와 host가 미리 구현한 layout option으로 표현한다.

### 1. v1 대비 추가 기능

v1은 반복 목록의 `setColumns`만 허용한다. v2 prototype도 현재 `setColumns`만 구현하고 `reserved-bottom-controls` capability를 통해 정책상 허용 열을 좁힌다. 범용 v2는 다음을 추가로 다룰 수 있게 한다.

- 열 수 외에 카드/메뉴의 사전 구현 배치 패턴 선택
- host가 정의한 간격 및 터치 대상 크기 preset 선택
- 등록된 scroll container의 스크롤 preset 선택
- 고정 하단 UI와 접근성 조건을 layout 제약으로 모델링
- 여러 요소를 함께 선택할 경우 정책 검증을 통과한 일관된 조합만 반환

AI는 CSS, HTML, DOM, class 이름, 임의 숫자 값, 실행 가능한 코드를 만들지 않는다. 결과는 host에 이미 구현된 token 또는 layout preset 식별자의 선택이어야 한다.

### 2. 공통 model의 필수 입력

v2 model은 현재 필드를 유지하고, 레이아웃 선택에 필요한 선택지를 등록 정책에서 파생한다.

| 영역 | 필수 정보 |
|---|---|
| 계약 식별 | `schemaVersion`, `contractVersion`, `hostId`, `screenId`, `structureVersion` |
| 화면 fingerprint | 재계산 가능한 `structureHash`, `constraintHash`; plan의 stale 여부 판단에 사용 |
| 표시 조건 | 제한된 `viewportClass`와 명시적 접근성 요약(`textScale`, `buttonScale`, `contrast`, `viewportMode`) |
| runtime capabilities | 등록된 capability만 포함. `reserved-bottom-controls`는 현재 prototype의 의미를 유지하며, user preference와 분리 |
| layout component | 안정 ID, 의미 역할, 순서, component 종류 및 그 component에 등록된 operation·option 목록 |
| 적용 범위 | item count/order의 무결성 fingerprint는 host/validator가 필요에 따라 보유하되, 생성 모델에는 항목 내용·개별 ID·개인정보를 넣지 않음 |

AI에 전달하는 prompt payload는 검증된 모델에서 최소 정보만 추린다. 후보 option ID, 허용 연산, 접근성 조건 및 불투명한 model fingerprint 외에는 목록 내용, 개인정보, DOM/HTML, 선택 상태를 보내지 않는다. `itemCount`나 `itemOrderHash`를 provider에 보낼 필요가 있는지는 별도 승인 대상으로 두고 기본값은 제외한다.

실제 viewport 픽셀, reserved region geometry를 contract에 넣을지는 아직 미결이다. 현재 v1처럼 세분화된 viewport class와 capability만 사용할 경우 중앙 validator는 host의 실측을 독립 검증할 수 없다. 고정 footer 충돌을 다루는 host는 자신의 현재 usable region을 신뢰성 있게 측정하지 못하면 AI plan 적용을 보류해야 한다. 필요하면 후속 schema에서 경계·단위·회전/resize 갱신 규칙을 명시적으로 승인한다.

### 3. AI가 선택할 operation 목록

기본 원칙은 operation이 임의 CSS 값이 아니라 등록된 유한 선택지를 참조하는 것이다.

| 제안 operation | 대상 | AI 선택 값 | 의미 |
|---|---|---|---|
| `setColumns` | 등록된 반복 목록 | 허용된 정수 열 수 | v1에서 이어지는 열 수 선택 |
| `setArrangement` | 등록된 카드/메뉴 container | host policy가 허용한 `optionId` | 예: 등록된 grid/list 또는 세로/가로 카드 배치 |
| `setSpacingPreset` | 등록된 layout group | `spacingPresetId` | host가 구현한 간격 token 묶음 선택 |
| `setTouchTargetPreset` | 등록된 조작 요소 group | `targetPresetId` | host가 구현한 크기 preset 선택. 실제 최소 터치 크기는 preset metadata와 policy가 보장 |
| `setScrollPreset` | 명시적으로 등록된 scroll container | `scrollPresetId` | 페이지/영역 스크롤 등 검증된 host 옵션 선택 |

`reserved-bottom-controls`는 operation이 아니라 현재 화면 상태를 나타내는 capability로 유지한다. AI가 footer를 이동·숨김·축소하거나 dock/fixed control의 위치와 기능을 바꾸는 operation은 허용하지 않는다. 큰 글씨·큰 버튼·고대비는 user preference를 AI가 바꾸는 명령이 아니다. 해당 값은 constraint로만 사용하며 AI는 그 제약 안에서 layout preset만 고른다.

처음 구현할 때 operation들이 서로 충돌하기 쉬우면, 이 목록을 바로 모두 열기보다 `selectLayoutPreset` 하나로 시작하는 대안도 있다. preset은 columns, arrangement, spacing, touch-target, scroll 설정을 host가 미리 검증한 원자적 조합으로 묶는다. 어느 방식을 선택할지는 승인 전 결정사항이다.

### 4. operation 안전 제약

- `setColumns`: component별 allowed set 안의 값만 허용한다. accessibility와 capability가 허용 집합을 줄일 수는 있지만 확장할 수 없다.
- `setArrangement`: 등록된 layout component와 preset ID에만 허용한다. 항목 순서·내용·선택·업무 행동을 표현하는 preset은 등록 금지한다.
- `setSpacingPreset`: 등록된 token ID만 허용한다. 보호된 요소를 가리거나 footer·QR dock와 겹칠 수 있는 선택지는 해당 화면 정책에 등록하지 않는다.
- `setTouchTargetPreset`: 적용 결과의 모든 interactive target이 policy와 accessibility에서 요구하는 최솟값 이상이어야 한다. AI가 픽셀 수를 직접 낮추거나 접근성 preference를 변경할 수 없다.
- `setScrollPreset`: 등록된 scroll container와 사전 테스트한 옵션에만 허용한다. 항목을 자르거나 재정렬하거나 focus/keyboard navigation을 잃게 하는 preset은 거부한다. 바깥/안쪽 중첩 scroll은 policy가 명시적으로 허용하고 검증하지 않으면 금지한다.
- plan은 model fingerprint를 그대로 가져야 하며, stale model·미등록 component·중복/상충 operation·추가 필드는 거부한다.
- 저장/발급/결제/선택/인증/업무 단계 변화는 operation schema에 넣지 않는다.
- validator가 실패하면 자동 수정, 재생성, 안전하지 않은 기본 plan 적용 없이 현재 host layout을 유지한다.

다음은 layout contract 및 provider payload에서 제외하고, AI가 직접 읽거나 변경할 수 없는 불변 영역이다.

- 메뉴·증명서 등 업무 항목의 실제 내용과 표시/처리 순서
- 개인정보, 입력값 및 항목별 식별 정보
- 현재 선택 상태
- 주문, 결제, 발급 및 기타 업무 실행 action
- QR 인증 정보와 인증 흐름
- 접근성 프로필 값의 저장·수정
- 업무 단계 전환 및 실행 로직

### 5. Host가 지원 기능을 선언하는 방법

지원 선언은 요청이 임의로 정하는 권한 목록이 아니라 중앙에 등록된 host/screen policy가 소유한다. policy는 component별로 다음을 선언한다.

1. 안정 component ID, kind/role, 구조 순서 및 보호 속성
2. 허용 operation 종류와 각 operation의 명시적 option ID 집합
3. option ID의 host 의미와 정적 안전 metadata (예: columns, minimum touch size, spacing token, scroll container behavior)
4. viewport/accessibility 조건과 capabilities가 option 집합에 미치는 제한
5. operation 조합 제약, fixed/reserved region과 겹치지 않는다는 host layout 보증

요청의 capability는 policy가 허용한 현재 runtime 상태만 선언한다. `reserved-bottom-controls`가 없다는 것은 “미asserted”이지 “footer가 없음”이 아니다. 감지 상태가 unknown, stale 또는 실패면 host는 빈 목록을 보내 AI가 여유 공간이 있다고 가정하게 해서는 안 된다. 기존 초안에 따라 이 경우 안전한 non-AI layout을 유지한다. preference `bottomControls`, `viewportMode`, DOM에 footer 요소가 존재한다는 사실만으로 실측 capability를 추론하지 않는다.

이 구조는 병원·은행·교통 키오스크에도 같은 contract를 사용하게 한다. 각 업종 전용 프롬프트나 새 host 구현 없이, 해당 host가 실제 지원하는 component 및 preset을 등록할 때만 공통 생성기가 선택한다. 등록되지 않은 host/screen은 지원하지 않는다.

### 6. validator 검증 기준

검증은 두 단계로 수행한다.

**Model 검증**

- v2 strict schema, 버전, host/screen/structure identity를 확인한다.
- 등록 policy로 component, capability, option set을 다시 계산한다. 요청이 option 집합을 임의로 넓히거나 좁히지 못하게 한다.
- 구조 hash와 constraint hash를 canonicalization 규칙으로 재계산한다. capability, 접근성, viewport, option set, preset metadata 변경은 constraint hash를 바꿔야 한다.
- duplicate ID/order/capability/option을 거부하고, 한 component에 허용되지 않은 operation을 노출하지 않는다.
- reserved region 측정이 필요하다고 policy가 정했는데 host state가 unknown이면 model을 거부하거나 host가 AI 적용을 중지한다.

**Plan 검증**

- 응답은 strict plan schema를 통과해야 하고 model의 version, host, screen, structure, 두 hash, viewport와 일치해야 한다.
- operation별 대상·option ID가 model과 등록 policy 모두에 포함되는지 확인한다.
- 버튼 target minimum, spacing/arrangement preset, scroll/focus 보증 등 option metadata를 적용해도 안전한지 검증한다.
- operation 개수/중복 target 제한과 상호 조합 규칙을 확인한다. 권장 초기 규칙은 동일 component에 동일 operation을 두 번 허용하지 않고, 서로 덮어쓰는 조합은 명시적 policy 없이는 거부하는 것이다.
- host는 적용 직전에 원본 model과 다시 검증하고, 화면 fingerprint가 바뀌었거나 capability/viewport가 바뀌면 결과를 버린다.

현재 v2 plan validator는 columns와 capability effect를 확인한다. 추가로 내부 option selector는 등록 option ID와 accessibility/capability-filtered 목록만 검증한다. 이 선택기는 AI plan operation이 아니며 spacing, touch-target, arrangement, scroll preset의 적용 안전성은 아직 구현되어 있지 않다. host의 실제 렌더링·footer 위치를 중앙 validator가 증명할 수 없으므로 측정 실패 시 fail closed 해야 한다.

### 7. v1 호환성

- v1은 `universal-layout.v1`과 현재 schema/hash/validator를 그대로 유지한다. v2 field나 operation을 v1 요청에 섞지 않는다.
- v2는 `schemaVersion: 2`, `contractVersion: "universal-layout.v2"`와 독립된 strict schema/hash namespace를 유지한다.
- v1 `setColumns` plan을 v2로 자동 변환하거나 그 반대로 변환하지 않는다.
- provider transport/orchestration은 나중에 공통화할 수 있지만, contract 선택, response schema, model/plan validator는 버전별로 분리한다.
- v1 route, Mock, cache, rate limit, host 적용 경로 변경은 v2 승인 범위에 포함되지 않는다.

### 8. 적용 예시

아래는 동작을 설명하는 policy 예시이며, 실제 DemoCoffee 또는 Civil host의 v2 등록 승인이나 적용을 뜻하지 않는다.

**DemoCoffee 메뉴:** `menu.product-list`가 `setColumns`와 등록된 card arrangement/spacing preset만 지원한다고 선언한다. 표준 글씨·일반 viewport에서는 1열/2열 option을 허용할 수 있다. 큰 글씨나 큰 버튼이면 policy가 1열 및 여유 있는 spacing preset만 model에 포함한다. 상품 이름·가격·카테고리·순서·선택·주문 action은 model/provider/operation에서 제외한다.

**무인민원발급기 증명서 메뉴:** `civil.certificate-grid`가 `setColumns`, touch-target preset, 승인된 scroll preset을 선언한다고 가정한다. 18개 증명서 내용/순서는 보호하고 item-order fingerprint로 model 변화를 탐지한다. 실제 footer/QR dock가 화면 하단을 차지하면 host가 측정한 reserved capability를 선언하고 registry가 충돌 가능한 조합을 제외한다. 큰 글씨, 높은 대비 또는 측정 실패는 더 안전한 허용 집합 또는 non-AI layout으로 처리한다. 발급/개인정보/QR 인증은 어떠한 AI operation에도 노출하지 않는다.

### 9. 단계별 구현 순서

1. **계약 합의:** 아래 승인 결정사항, operation 표현, model 필드, privacy payload 경계를 확정한다.
2. **공통 policy/option registry 확장:** 현재 구현된 option group/ID 기반에 승인된 preset metadata와 조합 규칙을 추가한다. 현재 구현은 accessibility/capability 필터링 및 선언된 option ID 검증까지만 제공한다.
3. **validator-only prototype 확장:** 현재 `setColumns`, capability, option hash/selection 및 중복 target 검증을 바탕으로 golden vectors, accessibility 최소값, scroll/overlap 조건을 승인된 범위에서 검증한다.
4. **host conformance fixtures:** 업종에 독립적인 fixture로 capability unknown/measurement failure, resize 및 footer 상태 변화 규칙을 확인한다. 실제 host 변경은 별도 승인 후 진행한다.
5. **v2 generator와 fake provider:** strict structured output과 공통 v2 validator만 연결하고 실제 네트워크 없이 검증한다.
6. **Development integration 승인:** 별도 요청으로 Development route/provider를 추가한다. 기본 OFF, v1/Production 분리, service Bearer 인증 유지, 실패 시 기존 화면 유지.
7. **host별 시험 및 운영 승인:** 호스트 자체 검증/적용, 접근성·업무 불변성 검증을 마친 뒤 각 실제 통합과 Production 사용을 따로 승인한다.

### 10. 구현 전 사용자 승인 필요 항목

1. 초기 v2는 여러 typed operation을 지원할지, 검증된 조합을 묶은 `selectLayoutPreset` 하나로 제한할지.
2. 허용 operation 목록과 option ID가 중앙 registry 소유인지, host manifest를 중앙이 승인·버전 관리하는 방식인지.
3. `reserved-bottom-controls`만 capability로 유지할지, edge/inset/geometry를 표현하는 새 capability/schema가 필요한지. 실측 단위와 unknown/failure 동작도 확정해야 한다.
4. viewport pixel dimensions와 item count/order hash 중 provider payload에 넣을 정보의 최소 범위. 개인정보·항목 내용은 어떤 경우에도 넣지 않는다.
5. 최소 터치 크기 및 spacing preset의 기준·단위·각 accessibility mode의 최솟값.
6. page/region scroll 전환을 v2 초기 범위에 넣을지, focus·키보드·nested scroll 검증을 마칠 때까지 보류할지.
7. 여러 operation의 원자적 조합/우선순위, 충돌 시 reject인지 단일 preset 강제인지.
8. capability 감지 unknown, resize 중 stale plan, 측정 실패 때 적용을 막는 host-side fail-closed 기준과 UI fallback.
9. v2 정책 registry와 golden vectors를 각 host와 어떻게 동기화하고 승인할지.

이 결정들이 승인되기 전에는 v2 구현, 실제 host 등록, 실제 AI 호출, API route/provider 추가 또는 Production 변경을 진행하지 않는다.
