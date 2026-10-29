import type { UniversalLayoutV2Accessibility } from "./universal-layout-contract-v2";

export type UniversalLayoutV2PilotProfile = "A" | "G";

const PROFILE_A: UniversalLayoutV2Accessibility = {
  textScale: "standard",
  buttonScale: "standard",
  contrast: "standard",
  viewportMode: null,
};

const PROFILE_G: UniversalLayoutV2Accessibility = {
  textScale: "large",
  buttonScale: "large",
  contrast: "high",
  viewportMode: { mode: "bottom", heightPercent: 70 },
};

export function getUniversalLayoutV2PilotProfile(
  accessibility: UniversalLayoutV2Accessibility,
): UniversalLayoutV2PilotProfile | null {
  if (
    accessibility.textScale === PROFILE_A.textScale &&
    accessibility.buttonScale === PROFILE_A.buttonScale &&
    accessibility.contrast === PROFILE_A.contrast &&
    accessibility.viewportMode === PROFILE_A.viewportMode
  ) return "A";

  if (
    accessibility.textScale === PROFILE_G.textScale &&
    accessibility.buttonScale === PROFILE_G.buttonScale &&
    accessibility.contrast === PROFILE_G.contrast &&
    accessibility.viewportMode?.mode === PROFILE_G.viewportMode?.mode &&
    accessibility.viewportMode?.heightPercent === PROFILE_G.viewportMode?.heightPercent
  ) return "G";

  return null;
}
