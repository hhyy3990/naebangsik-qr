export const PROFILE_SCHEMA_VERSION = 1 as const;

export type ProfilePreferences = {
  textSize: "standard" | "large" | "extraLarge";
  buttonSize: "standard" | "large";
  contrast: "standard" | "high";
  easyLanguage: boolean;
  simplifiedLayout: boolean;
  bottomControls: boolean;
  smartGuide: boolean;
  guideDelaySeconds: 10 | 15 | 20;
  voiceGuidance: boolean;
};

export type CreatedProfile = {
  id: string;
  token: string;
  managementKey: string;
  schemaVersion: typeof PROFILE_SCHEMA_VERSION;
  preferences: ProfilePreferences;
  createdAt: string;
};

export type ResolvedProfile = {
  schemaVersion: typeof PROFILE_SCHEMA_VERSION;
  preferences: ProfilePreferences;
  updatedAt: string;
};

export type ManagedProfile = ResolvedProfile & {
  id: string;
  active: boolean;
};

export const buildPublicQrUrl = (baseUrl: string, token: string) =>
  `${baseUrl.replace(/\/+$/, "")}/?token=${encodeURIComponent(token)}`;

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result.error || "요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.");
  }
  return result as T;
};

const managementHeaders = (managementKey: string) => ({
  "X-Profile-Management-Key": managementKey,
});

export const profileApi = {
  create: (preferences: ProfilePreferences) =>
    request<CreatedProfile>("/api/profiles", {
      method: "POST",
      body: JSON.stringify({ schemaVersion: PROFILE_SCHEMA_VERSION, preferences }),
    }),

  resolve: (token: string) =>
    request<ResolvedProfile>("/api/profiles/resolve", {
      method: "POST",
      cache: "no-store",
      body: JSON.stringify({ token }),
    }),

  getManaged: (id: string, managementKey: string) =>
    request<ManagedProfile>(`/api/profiles/${encodeURIComponent(id)}/manage`, {
      headers: managementHeaders(managementKey),
    }),

  update: (id: string, managementKey: string, preferences: ProfilePreferences) =>
    request<ManagedProfile>(`/api/profiles/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: managementHeaders(managementKey),
      body: JSON.stringify({ schemaVersion: PROFILE_SCHEMA_VERSION, preferences }),
    }),

  revoke: (id: string, managementKey: string) =>
    request<{ success: true }>(`/api/profiles/${encodeURIComponent(id)}/revoke`, {
      method: "POST",
      headers: managementHeaders(managementKey),
    }),

  rotate: (id: string, managementKey: string) =>
    request<{ token: string }>(`/api/profiles/${encodeURIComponent(id)}/rotate`, {
      method: "POST",
      cache: "no-store",
      headers: managementHeaders(managementKey),
    }),
};
