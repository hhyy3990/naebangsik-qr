import type { LayoutPolicy } from "./layout-plan";
import { DEMO_MENU_POLICY } from "./demo-menu-layout";

// Legacy generic SHA-256 policies are added only after review. DemoCafe v2
// is registered separately below because it has a different host contract.
export const registeredLayoutPolicies: readonly LayoutPolicy[] = [];

// DemoCafe v2 is validated with its own strict contract rather than the legacy
// generic SHA-256/operation format.
export const registeredDemoMenuPolicies = [DEMO_MENU_POLICY] as const;
