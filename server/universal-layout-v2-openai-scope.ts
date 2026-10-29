import { universalSha256 } from "./universal-layout-contract";
import type { UniversalLayoutV2Model } from "./universal-layout-contract-v2";
import type { DevelopmentUniversalLayoutV2Registration } from "./universal-layout-v2-development-registry";
import { getUniversalLayoutV2PilotProfile } from "./universal-layout-v2-pilot-profiles";

const DEMO_COFFEE_ITEM_ORDER_HASH =
  "af0c4a1b243d46755fc31fa279e936f612bf2b3914b293d67e585d6aa5fb091a";
const CIVIL_ORDERED_ITEM_IDS = Array.from(
  { length: 18 },
  (_, index) => `civil.certificate.${String(index + 1).padStart(2, "0")}`,
);
const CIVIL_ITEM_ORDER_HASH = universalSha256({ orderedItemIds: CIVIL_ORDERED_ITEM_IDS });

export class UniversalLayoutV2OpenAIScopeError extends Error {
  constructor(readonly code = "V2_OPENAI_SCOPE_REJECTED") {
    super(code);
    this.name = "UniversalLayoutV2OpenAIScopeError";
  }
}

/**
 * Restricts OpenAI generation to the host-reported Development snapshots.
 * Pixel dimensions are not part of the v2 model and are deliberately left to
 * the host's required fail-closed gate.
 */
export function validateUniversalLayoutV2OpenAIScope(
  model: UniversalLayoutV2Model,
  registration: DevelopmentUniversalLayoutV2Registration,
): void {
  const profile = getUniversalLayoutV2PilotProfile(model.accessibility);
  if (!profile) throw new UniversalLayoutV2OpenAIScopeError();

  if (model.components.length !== 1) throw new UniversalLayoutV2OpenAIScopeError();
  const component = model.components[0];
  if (
    component.id !== registration.componentId ||
    component.minimumTouchTargetPx !== 44 ||
    component.operations.length !== 2 ||
    !component.operations.includes("setColumns") ||
    !component.operations.includes("selectLayoutOption") ||
    component.optionGroups?.length !== 1 ||
    component.optionGroups[0].id !== "arrangement"
  ) {
    throw new UniversalLayoutV2OpenAIScopeError();
  }

  if (model.hostId === "democoffee") {
    if (
      model.screenId !== "cafe.menu" ||
      model.structureVersion !== "menu.v2" ||
      model.layoutCapabilities.length !== 0 ||
      !["compact", "regular", "wide"].includes(model.viewportClass) ||
      component.itemCount !== 5 ||
      component.itemOrderHash !== DEMO_COFFEE_ITEM_ORDER_HASH ||
      component.optionGroups[0].optionIds.length !== 1 ||
      component.optionGroups[0].optionIds[0] !==
        (profile === "A" ? "compact-grid" : "single-column-list")
    ) {
      throw new UniversalLayoutV2OpenAIScopeError();
    }
    return;
  }

  if (model.hostId === "civil-kiosk-development-test") {
    if (
      model.screenId !== "civil.main-menu" ||
      model.structureVersion !== "civil-main-menu.v2-test" ||
      model.viewportClass !== "wide" ||
      model.layoutCapabilities.length !== 1 ||
      model.layoutCapabilities[0] !== "reserved-bottom-controls" ||
      component.itemCount !== 18 ||
      component.itemOrderHash !== CIVIL_ITEM_ORDER_HASH ||
      component.optionGroups[0].optionIds.length !== 1 ||
      component.optionGroups[0].optionIds[0] !== "reserved-safe-list"
    ) {
      throw new UniversalLayoutV2OpenAIScopeError();
    }
    return;
  }

  throw new UniversalLayoutV2OpenAIScopeError();
}
