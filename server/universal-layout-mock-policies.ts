import type { UniversalLayoutPolicy } from "./universal-layout-contract";

export const DEMO_COFFEE_UNIVERSAL_MOCK_POLICY: UniversalLayoutPolicy = {
  hostId: "democoffee",
  screenId: "cafe.menu",
  structureVersion: "menu.v2",
  components: [{
    id: "menu.product-list",
    kind: "repeated-card-list",
    role: "ordered-menu-list",
    order: 0,
    itemCountRange: [0, 100],
    operations: ["setColumns"],
    allowedColumnsByViewport: { compact: [1], regular: [1, 2], wide: [1, 2] },
    singleColumnForLargeText: true,
    singleColumnForLargeButtons: true,
    singleColumnForHighContrast: false,
    singleColumnForBottomViewport: false,
    minimumTouchTargetPx: 44,
    protectedProperties: ["items", "order", "selection", "actions"],
  }],
};

// Development-only fixture copied from the supplied width-specific execution values.
// The mapping from pixel widths to these viewport classes is still an assumption.
// Actual hostId/structureVersion and hash compatibility remain unconfirmed.
export const CIVIL_SERVICE_UNIVERSAL_MOCK_POLICY: UniversalLayoutPolicy = {
  hostId: "civil-kiosk-mock",
  screenId: "civil.main-menu",
  structureVersion: "civil-main-mock.v1",
  components: [{
    id: "civil.certificate-grid",
    kind: "repeated-card-list",
    role: "certificate-choice-list",
    order: 0,
    itemCountRange: [18, 18],
    operations: ["setColumns"],
    allowedColumnsByViewport: { compact: [1], regular: [1, 2], wide: [1, 2] },
    singleColumnForLargeText: true,
    singleColumnForLargeButtons: true,
    singleColumnForHighContrast: true,
    singleColumnForBottomViewport: true,
    minimumTouchTargetPx: 44,
    protectedProperties: ["items", "order", "selection", "issuance-actions"],
  }],
};

export const UNIVERSAL_LAYOUT_MOCK_POLICIES = [
  DEMO_COFFEE_UNIVERSAL_MOCK_POLICY,
  CIVIL_SERVICE_UNIVERSAL_MOCK_POLICY,
] as const;
