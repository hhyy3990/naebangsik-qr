import type { UniversalLayoutV2Policy } from "./universal-layout-contract-v2";

/**
 * Test-only conformance policy for export examples.
 * This is not a production registration or approval for the DemoCoffee host.
 */
export const DEMO_COFFEE_UNIVERSAL_V2_CONFORMANCE_POLICY: UniversalLayoutV2Policy = {
  hostId: "democoffee",
  screenId: "cafe.menu",
  structureVersion: "menu.v2",
  allowedCapabilities: [],
  capabilityRules: {},
  components: [{
    id: "menu.product-list",
    kind: "repeated-card-list",
    role: "ordered-menu-list",
    order: 0,
    itemCountRange: [0, 100],
    allowedColumnsByViewport: { compact: [1], regular: [1, 2], wide: [1, 2] },
    singleColumnForLargeText: true,
    singleColumnForLargeButtons: true,
    singleColumnForHighContrast: false,
    singleColumnForBottomViewport: false,
    operations: ["setColumns"],
    optionGroups: [{
      id: "arrangement",
      options: [
        { id: "compact-grid", accessibility: { textScale: ["standard"] } },
        { id: "large-text-list", accessibility: { textScale: ["large", "extraLarge"] } },
      ],
    }],
    minimumTouchTargetPx: 44,
    protectedProperties: ["items", "order", "selection", "actions"],
  }],
};

/**
 * Test-only Civil policy copied from the v2 conformance tests.
 * The host identifier/version are mock values and are not host-confirmed.
 */
export const CIVIL_UNIVERSAL_V2_CONFORMANCE_POLICY: UniversalLayoutV2Policy = {
  hostId: "civil-kiosk-mock",
  screenId: "civil.main-menu",
  structureVersion: "civil-main-mock.v1",
  allowedCapabilities: ["reserved-bottom-controls"],
  capabilityRules: {
    "reserved-bottom-controls": {
      componentIds: ["civil.certificate-grid"],
      maximumColumns: 1,
    },
  },
  components: [{
    id: "civil.certificate-grid",
    kind: "repeated-card-list",
    role: "certificate-choice-list",
    order: 0,
    itemCountRange: [18, 18],
    allowedColumnsByViewport: { compact: [1], regular: [1, 2], wide: [1, 2] },
    singleColumnForLargeText: true,
    singleColumnForLargeButtons: true,
    singleColumnForHighContrast: true,
    singleColumnForBottomViewport: true,
    operations: ["setColumns"],
    optionGroups: [{
      id: "arrangement",
      options: [
        {
          id: "compact-grid",
          excludesCapabilities: ["reserved-bottom-controls"],
          accessibility: { textScale: ["standard"] },
        },
        { id: "reserved-safe-list", requiresCapabilities: ["reserved-bottom-controls"] },
        { id: "large-text-list", accessibility: { textScale: ["large", "extraLarge"] } },
      ],
    }],
    minimumTouchTargetPx: 44,
    protectedProperties: ["items", "order", "selection", "issuance-actions"],
  }],
};

/**
 * Development policy reconstructed from the supplied DemoCoffee host report.
 * This confirms only the reported model profiles; hostPolicyVerified stays false.
 */
export const DEMO_COFFEE_HOST_DEVELOPMENT_V2_POLICY: UniversalLayoutV2Policy = {
  hostId: "democoffee",
  screenId: "cafe.menu",
  structureVersion: "menu.v2",
  allowedCapabilities: [],
  capabilityRules: {},
  components: [{
    id: "menu.product-list",
    kind: "repeated-card-list",
    role: "ordered-menu-list",
    order: 0,
    itemCountRange: [0, 100],
    allowedColumnsByViewport: { compact: [1], regular: [1, 2], wide: [1, 2] },
    singleColumnForLargeText: true,
    singleColumnForLargeButtons: true,
    singleColumnForHighContrast: false,
    singleColumnForBottomViewport: false,
    operations: ["setColumns"],
    optionGroups: [{
      id: "arrangement",
      options: [{
        id: "compact-grid",
        accessibility: {
          textScale: ["standard"],
          buttonScale: ["standard"],
        },
      }],
    }],
    minimumTouchTargetPx: 44,
    protectedProperties: ["items", "order", "selection", "actions"],
  }],
};

/**
 * Development policy reconstructed from the supplied Civil host report.
 * The report's local model validates, but this is not a Production registration.
 */
export const CIVIL_KIOSK_HOST_DEVELOPMENT_V2_POLICY: UniversalLayoutV2Policy = {
  hostId: "civil-kiosk-development-test",
  screenId: "civil.main-menu",
  structureVersion: "civil-main-menu.v2-test",
  allowedCapabilities: ["reserved-bottom-controls"],
  capabilityRules: {
    "reserved-bottom-controls": {
      componentIds: ["civil.certificate-grid"],
      maximumColumns: 1,
    },
  },
  components: [{
    id: "civil.certificate-grid",
    kind: "repeated-card-list",
    role: "certificate-choice-list",
    order: 0,
    itemCountRange: [18, 18],
    allowedColumnsByViewport: { compact: [1], regular: [1, 2], wide: [1, 2] },
    singleColumnForLargeText: true,
    singleColumnForLargeButtons: true,
    singleColumnForHighContrast: true,
    singleColumnForBottomViewport: true,
    operations: ["setColumns"],
    optionGroups: [{
      id: "arrangement",
      options: [{
        id: "reserved-safe-list",
        requiresCapabilities: ["reserved-bottom-controls"],
      }],
    }],
    minimumTouchTargetPx: 44,
    protectedProperties: ["items", "order", "selection", "issuance-actions"],
  }],
};
