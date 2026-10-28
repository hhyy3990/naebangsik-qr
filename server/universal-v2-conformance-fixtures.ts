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
