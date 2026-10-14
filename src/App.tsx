import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import {
  Accessibility,
  AlertCircle,
  ArrowDownToLine,
  ArrowRight,
  Check,
  CheckCircle2,
  CircleHelp,
  FileKey2,
  KeyRound,
  LockKeyhole,
  Monitor,
  QrCode,
  RotateCw,
  ShieldCheck,
  Sparkles,
  Type,
  Volume2,
} from "lucide-react";
import AIRecommendationFlow from "./AIRecommendationFlow";
import {
  buildPublicQrUrl,
  PROFILE_LANGUAGES,
  profileApi,
  type ManagedProfile,
  type ProfilePreferences,
  type ResolvedProfile,
} from "./lib/profile";

type StoredProfile = {
  id: string;
  token: string;
  managementKey: string;
};

type Notice = {
  kind: "success" | "error" | "info";
  message: string;
};

type PublicAppConfig = {
  publicAppUrl: string | null;
  isPreview: boolean;
};

const STORAGE_KEY = "myway-qr-managed-profile";

const DEFAULT_PREFERENCES: ProfilePreferences = {
  textSize: "standard",
  buttonSize: "standard",
  contrast: "standard",
  easyLanguage: false,
  viewportMode: null,
  smartGuide: false,
  guideDelaySeconds: 15,
  voiceGuidance: false,
  language: "ko",
  stepByStepGuidance: false,
  conciseGuidance: false,
  slowGuidance: false,
};

const languageLabels: Record<(typeof PROFILE_LANGUAGES)[number], string> = {
  ko: "한국어",
  zh: "중국어",
  vi: "베트남어",
  en: "영어",
  th: "태국어",
  uz: "우즈베크어",
  ja: "일본어",
};

function readStoredProfile(): StoredProfile | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return null;
    const parsed = JSON.parse(saved) as Partial<StoredProfile>;
    if (
      typeof parsed.id === "string" &&
      typeof parsed.token === "string" &&
      typeof parsed.managementKey === "string"
    ) {
      return {
        id: parsed.id,
        token: parsed.token,
        managementKey: parsed.managementKey,
      };
    }
  } catch {
    return null;
  }
  return null;
}

function ChoiceGroup<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { label: string; value: T }[];
  onChange: (next: T) => void;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          className="segment"
          type="button"
          key={option.value}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function ToggleRow({
  title,
  description,
  checked,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="toggle-row">
      <div className="setting-info">
        <strong>{title}</strong>
        <span>{description}</span>
      </div>
      <button
        className="toggle-control"
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={title}
        onClick={() => onChange(!checked)}
      >
        <span className="toggle-knob" />
      </button>
    </div>
  );
}

function Feedback({ notice }: { notice: Notice }) {
  const Icon = notice.kind === "error" ? AlertCircle : notice.kind === "success" ? CheckCircle2 : CircleHelp;
  return (
    <div className={`feedback ${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>
      <Icon size={18} aria-hidden="true" />
      <span>{notice.message}</span>
    </div>
  );
}

function SettingsForm({
  preferences,
  onPreferenceChange,
  disabled,
}: {
  preferences: ProfilePreferences;
  onPreferenceChange: <K extends keyof ProfilePreferences>(key: K, value: ProfilePreferences[K]) => void;
  disabled: boolean;
}) {
  return (
    <fieldset disabled={disabled} className="settings-fieldset">
      <div className="section-label">
        <Type size={17} aria-hidden="true" />
        화면을 편하게 보는 방법
      </div>
      <div className="setting-row">
        <div className="setting-info">
          <strong>글씨 크기</strong>
          <span>읽기 편한 크기를 골라 주세요.</span>
        </div>
        <ChoiceGroup
          label="글씨 크기"
          value={preferences.textSize}
          options={[
            { label: "기본", value: "standard" },
            { label: "크게", value: "large" },
            { label: "아주 크게", value: "extraLarge" },
          ]}
          onChange={(value) => onPreferenceChange("textSize", value)}
        />
      </div>
      <div className="setting-row">
        <div className="setting-info">
          <strong>화면 대비</strong>
          <span>글자와 배경의 차이를 조절해요.</span>
        </div>
        <ChoiceGroup
          label="화면 대비"
          value={preferences.contrast}
          options={[
            { label: "기본", value: "standard" },
            { label: "고대비", value: "high" },
          ]}
          onChange={(value) => onPreferenceChange("contrast", value)}
        />
      </div>

      <div className="section-label">
        <Accessibility size={18} aria-hidden="true" />
        조작을 편하게 하는 방법
      </div>
      <div className="setting-row">
        <div className="setting-info">
          <strong>버튼 크기</strong>
          <span>누르기 편하도록 버튼을 키워요.</span>
        </div>
        <ChoiceGroup
          label="버튼 크기"
          value={preferences.buttonSize}
          options={[
            { label: "기본", value: "standard" },
            { label: "크게", value: "large" },
          ]}
          onChange={(value) => onPreferenceChange("buttonSize", value)}
        />
      </div>
      <div className="setting-row viewport-mode-row">
        <div className="setting-info">
          <strong>하단 조작 모드</strong>
          <span>화면 위쪽에 손이 닿기 어려운 경우, 아래쪽에서 화면을 조작할 수 있어요. 화면을 축소하지 않고 사용할 영역 안에서 스크롤합니다.</span>
        </div>
        <div className="viewport-mode-options" role="group" aria-label="하단 조작 모드">
          {[
            { label: "사용하지 않음", value: null as ProfilePreferences["viewportMode"] },
            { label: "아래쪽 60% 사용", value: { mode: "bottom", heightPercent: 60 } as const },
            { label: "아래쪽 70% 사용", value: { mode: "bottom", heightPercent: 70 } as const },
            { label: "아래쪽 80% 사용", value: { mode: "bottom", heightPercent: 80 } as const },
          ].map((option) => {
            const selected =
              option.value === null
                ? preferences.viewportMode === null
                : preferences.viewportMode?.mode === option.value.mode &&
                  preferences.viewportMode.heightPercent === option.value.heightPercent;
            return (
              <button
                className="viewport-mode-option"
                type="button"
                key={option.label}
                aria-pressed={selected}
                onClick={() => onPreferenceChange("viewportMode", option.value)}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="section-label">
        <Sparkles size={17} aria-hidden="true" />
        안내를 더 편하게 받기
      </div>
      <ToggleRow
        title="쉬운 말 안내"
        description="짧고 쉬운 문장으로 안내해요."
        checked={preferences.easyLanguage}
        onChange={(value) => onPreferenceChange("easyLanguage", value)}
      />
      <ToggleRow
        title="스마트 길잡이"
        description="화면을 멈춰 보고 있으면 다음 단계를 알려드려요."
        checked={preferences.smartGuide}
        onChange={(value) => onPreferenceChange("smartGuide", value)}
      />
      {preferences.smartGuide && (
        <div className="setting-row guide-delay-row">
          <div className="setting-info">
            <strong>길잡이 시작 시간</strong>
            <span>이 시간 동안 조작이 없으면 안내를 시작해요.</span>
          </div>
          <select
            className="select-control"
            aria-label="길잡이 시작 시간"
            value={preferences.guideDelaySeconds}
            onChange={(event) => onPreferenceChange("guideDelaySeconds", Number(event.target.value) as 10 | 15 | 20)}
          >
            <option value={10}>10초 후</option>
            <option value={15}>15초 후</option>
            <option value={20}>20초 후</option>
          </select>
        </div>
      )}
      <ToggleRow
        title="음성 안내"
        description="화면의 안내를 음성으로도 들을 수 있어요."
        checked={preferences.voiceGuidance}
        onChange={(value) => onPreferenceChange("voiceGuidance", value)}
      />
      <div className="setting-row">
        <div className="setting-info">
          <strong>안내 언어</strong>
          <span>국적이 아니라 편하게 사용하는 언어를 골라 주세요.</span>
        </div>
        <select
          className="select-control"
          aria-label="안내 언어"
          value={preferences.language}
          onChange={(event) => onPreferenceChange("language", event.target.value as ProfilePreferences["language"])}
        >
          {PROFILE_LANGUAGES.map((language) => (
            <option key={language} value={language}>{languageLabels[language]}</option>
          ))}
        </select>
      </div>
      <ToggleRow
        title="순서대로 안내받기"
        description="해야 할 일을 하나씩 차례대로 알려드려요."
        checked={preferences.stepByStepGuidance}
        onChange={(value) => onPreferenceChange("stepByStepGuidance", value)}
      />
      <ToggleRow
        title="짧게 안내받기"
        description="꼭 필요한 내용만 짧게 알려드려요."
        checked={preferences.conciseGuidance}
        onChange={(value) => onPreferenceChange("conciseGuidance", value)}
      />
      <ToggleRow
        title="천천히 안내받기"
        description="스마트 길잡이를 15초 동안 보여드려요."
        checked={preferences.slowGuidance}
        onChange={(value) => onPreferenceChange("slowGuidance", value)}
      />
      {!preferences.smartGuide && (
        <p className="setting-note">천천히 안내받기는 스마트 길잡이를 켰을 때 사용할 수 있어요. 지금 선택한 값은 저장됩니다.</p>
      )}
      <p className="setting-note">새 안내 설정은 지원 키오스크에 순차적으로 적용될 예정입니다.</p>
    </fieldset>
  );
}

function Preview({ preferences }: { preferences: ProfilePreferences }) {
  const viewportPercent = preferences.viewportMode?.heightPercent ?? 100;
  const classNames = [
    "kiosk-screen",
    `text-${preferences.textSize}`,
    `button-${preferences.buttonSize}`,
    `contrast-${preferences.contrast}`,
    preferences.easyLanguage ? "easy-language" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const options = ["메뉴 보기", "주문 조회", "직원 도움 요청"];
  return (
    <aside className="panel preview-panel" aria-label="설정 미리보기">
      <div className="preview-head">
        <h3>설정 미리보기</h3>
        <span className="preview-live">바로 반영</span>
      </div>
      <div className="preview-stage">
          <div className={classNames}>
            {viewportPercent < 100 && (
              <div
                className="kiosk-unused-region"
                style={{ height: `${100 - viewportPercent}%` }}
                aria-hidden="true"
              >
                사용하지 않는 위쪽 영역
              </div>
            )}
            <div className="kiosk-usable-region" style={{ height: `${viewportPercent}%` }}>
              <div className="kiosk-inner">
                <div className="kiosk-header">
                  <span>이음 키오스크</span>
                  <span>{preferences.voiceGuidance ? "음성 안내 켜짐" : "화면 안내"}</span>
                </div>
                <h4>무엇을 도와드릴까요?</h4>
                <p>안내 언어 · {languageLabels[preferences.language]}</p>
                <p>원하는 항목을 선택해 주세요.</p>
                <div className="kiosk-options">
                  {options.map((option) => (
                    <div className="kiosk-option" key={option}>
                      <span>{option}</span>
                      <ArrowRight size={15} aria-hidden="true" />
                    </div>
                  ))}
                </div>
                {preferences.smartGuide && (
                  <p className="guide-preview-message">
                    {preferences.guideDelaySeconds}초 동안 기다리면 길잡이가 안내해요.
                  </p>
                )}
                <div className="kiosk-footer">
                  <span>이전</span>
                  <span>다음</span>
                </div>
              </div>
            </div>
        </div>
        <p className="preview-caption">
          {viewportPercent === 100
            ? "전체 높이를 사용하는 미리보기예요."
            : `아래쪽 ${viewportPercent}% 영역 안에서 조작하고 스크롤하는 모습을 표시해요. 실제 키오스크 적용 화면과 다를 수 있습니다.`}
        </p>
      </div>
    </aside>
  );
}

function SkeletonCard() {
  return (
    <div className="loading-card" role="status" aria-label="저장한 프로필을 불러오는 중">
      <div className="loading-lines">
        <div className="skeleton wide" />
        <div className="skeleton medium" />
        <div className="skeleton" />
      </div>
    </div>
  );
}

export default function App() {
  const queryToken = useMemo(() => new URLSearchParams(window.location.search).get("token"), []);
  const [preferences, setPreferences] = useState<ProfilePreferences>(DEFAULT_PREFERENCES);
  const [saved, setSaved] = useState<StoredProfile | null>(() => readStoredProfile());
  const [managed, setManaged] = useState<ManagedProfile | null>(null);
  const [managedLoading, setManagedLoading] = useState(() => Boolean(readStoredProfile()));
  const [managedError, setManagedError] = useState("");
  const [managedRetry, setManagedRetry] = useState(0);
  const [publicProfile, setPublicProfile] = useState<ResolvedProfile | null>(null);
  const [publicLoading, setPublicLoading] = useState(Boolean(queryToken));
  const [publicError, setPublicError] = useState("");
  const [publicRetry, setPublicRetry] = useState(0);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [aiResultActive, setAiResultActive] = useState(false);
  const [aiQuestionSignal, setAiQuestionSignal] = useState(0);
  const [busy, setBusy] = useState(false);
  const rotationInProgress = useRef(false);
  const [publicAppConfig, setPublicAppConfig] = useState<PublicAppConfig | null>(null);
  const [publicAppConfigError, setPublicAppConfigError] = useState("");
  const [qr, setQr] = useState<{ publicUrl: string; dataUrl: string } | null>(null);
  const [qrGenerationError, setQrGenerationError] = useState("");
  const [autoScrollToQr, setAutoScrollToQr] = useState(false);

  useEffect(() => {
    let current = true;
    fetch("/api/public-config")
      .then(async (response) => {
        const payload = await response.json().catch(() => null) as {
          publicAppUrl?: unknown;
          isPreview?: unknown;
          error?: string;
        } | null;
        if (
          !response.ok ||
          !payload ||
          typeof payload.isPreview !== "boolean" ||
          (payload.publicAppUrl !== null && typeof payload.publicAppUrl !== "string")
        ) {
          throw new Error(payload?.error || "공개 주소를 확인하지 못했어요.");
        }
        return {
          publicAppUrl: typeof payload.publicAppUrl === "string" ? payload.publicAppUrl : null,
          isPreview: payload.isPreview,
        };
      })
      .then((config) => {
        if (current) {
          setPublicAppConfig(config);
          setPublicAppConfigError("");
        }
      })
      .catch(() => {
        if (!current) return;
        if (import.meta.env.DEV) {
          setPublicAppConfig({ publicAppUrl: null, isPreview: true });
          setPublicAppConfigError("");
        } else {
          setPublicAppConfig(null);
          setPublicAppConfigError("공개 QR 주소를 확인할 수 없어 QR을 준비하지 못했어요.");
        }
      });

    return () => {
      current = false;
    };
  }, []);

  const publicUrl = useMemo(() => {
    if (!saved?.token || !publicAppConfig) return "";
    const baseUrl = publicAppConfig.publicAppUrl ?? window.location.origin;
    return buildPublicQrUrl(baseUrl, saved.token);
  }, [saved?.token, publicAppConfig]);
  const qrDataUrl = qr?.publicUrl === publicUrl ? qr.dataUrl : "";

  useEffect(() => {
    if (!queryToken) return;
    let current = true;
    setPublicLoading(true);
    setPublicError("");
    setPublicProfile(null);
    profileApi
      .resolve(queryToken)
      .then((profile) => {
        if (current) setPublicProfile(profile);
      })
      .catch((error: unknown) => {
        if (current) setPublicError(error instanceof Error ? error.message : "설정을 불러오지 못했어요.");
      })
      .finally(() => {
        if (current) setPublicLoading(false);
      });
    return () => {
      current = false;
    };
  }, [queryToken, publicRetry]);

  useEffect(() => {
    if (!queryToken) return;
    let wasHidden = document.visibilityState === "hidden";
    let lastRefreshAt = 0;
    const revalidate = () => {
      const now = Date.now();
      if (now - lastRefreshAt < 750) return;
      lastRefreshAt = now;
      setPublicRetry((retry) => retry + 1);
    };
    const onVisibilityChange = () => {
      const isHidden = document.visibilityState === "hidden";
      if (wasHidden && !isHidden) revalidate();
      wasHidden = isHidden;
    };
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) revalidate();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [queryToken]);

  useEffect(() => {
    if (queryToken || !saved) {
      setManagedLoading(false);
      setManaged(null);
      return;
    }
    let current = true;
    setManagedLoading(true);
    setManagedError("");
    profileApi
      .getManaged(saved.id, saved.managementKey)
      .then((profile) => {
        if (!current) return;
        setManaged(profile);
        setPreferences(profile.preferences);
      })
      .catch((error: unknown) => {
        if (current) setManagedError(error instanceof Error ? error.message : "저장한 설정을 불러오지 못했어요.");
      })
      .finally(() => {
        if (current) setManagedLoading(false);
      });
    return () => {
      current = false;
    };
  }, [saved?.id, saved?.managementKey, queryToken, managedRetry]);

  useEffect(() => {
    let current = true;
    if (!publicUrl) {
      setQr(null);
      setQrGenerationError("");
      return;
    }
    setQr(null);
    setQrGenerationError("");
    QRCode.toDataURL(publicUrl, {
      width: 320,
      margin: 2,
      errorCorrectionLevel: "M",
      color: { dark: "#20324c", light: "#fffefa" },
    })
      .then((dataUrl) => {
        if (current) setQr({ publicUrl, dataUrl });
      })
      .catch(() => {
        if (current) setQrGenerationError("QR 이미지를 만들지 못했어요. 다시 시도해 주세요.");
      });
    return () => {
      current = false;
    };
  }, [publicUrl]);

  useEffect(() => {
    if (!autoScrollToQr || !qrDataUrl || !managed?.active) return;
    const frame = window.requestAnimationFrame(() => {
      const qrSection = document.getElementById("my-qr");
      if (!qrSection) return;
      const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      qrSection.scrollIntoView({
        behavior: prefersReducedMotion ? "auto" : "smooth",
        block: "start",
      });
      qrSection.focus({ preventScroll: true });
      setAutoScrollToQr(false);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [autoScrollToQr, qrDataUrl, managed?.active]);

  function changePreference<K extends keyof ProfilePreferences>(key: K, value: ProfilePreferences[K]) {
    setPreferences((current) => ({ ...current, [key]: value }));
  }

  function persistStoredProfile(profile: StoredProfile) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
    setSaved(profile);
  }

  async function savePreferences() {
    setBusy(true);
    setNotice(null);
    try {
      if (managed?.active && saved) {
        const updated = await profileApi.update(saved.id, saved.managementKey, preferences);
        setManaged(updated);
        setPreferences(updated.preferences);
        setNotice({ kind: "success", message: "설정을 저장했어요. 미리보기에 보이는 내용이 QR에도 적용됩니다." });
      } else {
        const created = await profileApi.create(preferences);
        const stored: StoredProfile = {
          id: created.id,
          token: created.token,
          managementKey: created.managementKey,
        };
        persistStoredProfile(stored);
        setManaged({
          id: created.id,
          active: true,
          schemaVersion: created.schemaVersion,
          preferences: created.preferences,
          updatedAt: created.createdAt,
        });
        setPreferences(created.preferences);
        setNotice({ kind: "success", message: "내 QR을 만들었어요. 아래에서 QR 이미지를 저장할 수 있어요." });
        setAutoScrollToQr(true);
      }
    } catch {
      setNotice({
        kind: "error",
        message: "설정을 저장하지 못했어요. 연결을 확인하고 다시 시도해 주세요.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function revokeQr() {
    if (!saved || !managed?.active) return;
    const confirmed = window.confirm(
      "기존 QR 사용을 중지하면 더 이상 설정을 불러올 수 없어요. 이 QR의 사용을 중지할까요?",
    );
    if (!confirmed) return;
    setBusy(true);
    setNotice(null);
    try {
      await profileApi.revoke(saved.id, saved.managementKey);
      setManaged({ ...managed, active: false });
      setNotice({ kind: "success", message: "기존 QR 사용을 중지했어요. 이 QR로는 더 이상 설정을 불러올 수 없습니다." });
    } catch {
      setNotice({ kind: "error", message: "QR 사용을 중지하지 못했어요. 연결을 확인하고 다시 시도해 주세요." });
    } finally {
      setBusy(false);
    }
  }

  async function rotateQr() {
    if (!saved || !managed?.active || rotationInProgress.current) return;
    const confirmed = window.confirm(
      "새 QR을 만들면 지금 QR은 더 이상 작동하지 않아요. 새 QR을 만들까요?",
    );
    if (!confirmed) return;
    rotationInProgress.current = true;
    setBusy(true);
    setNotice(null);
    try {
      const result = await profileApi.rotate(saved.id, saved.managementKey, saved.token);
      if (!result.token || result.token === saved.token) {
        throw new Error("서버에서 새 QR을 발급하지 않았습니다.");
      }
      persistStoredProfile({ ...saved, token: result.token });
      setNotice({ kind: "success", message: "새 QR을 만들었어요. 이전 QR은 더 이상 사용할 수 없습니다." });
      setAutoScrollToQr(true);
    } catch (error) {
      setNotice({ kind: "error", message: "새 QR을 만들지 못했어요. 연결을 확인하고 다시 시도해 주세요." });
      if (error instanceof Error && error.message.includes("QR이 이미 바뀌었어요.")) {
        setNotice({ kind: "error", message: error.message });
      }
    } finally {
      rotationInProgress.current = false;
      setBusy(false);
    }
  }

  function downloadQr() {
    if (!qrDataUrl) return;
    const link = document.createElement("a");
    link.href = qrDataUrl;
    link.download = "내-방식-QR.png";
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  function scrollToQr() {
    const qrSection = document.getElementById("my-qr");
    if (!qrSection) return;
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    qrSection.scrollIntoView({
      behavior: prefersReducedMotion ? "auto" : "smooth",
      block: "start",
    });
    qrSection.focus({ preventScroll: true });
  }

  function startCreating() {
    setAiResultActive(false);
    window.requestAnimationFrame(() => {
      const builder = document.getElementById("profile-builder");
      builder?.scrollIntoView({ behavior: "smooth", block: "start" });
      builder?.focus({ preventScroll: true });
    });
  }

  function applyAIRecommendation(
    next: ProfilePreferences,
    _reasons: string[],
    settingsAtRequestStart: ProfilePreferences,
  ) {
    if (JSON.stringify(preferences) !== JSON.stringify(settingsAtRequestStart)) return false;
    setPreferences(next);
    setAiResultActive(true);
    setNotice(null);
    return true;
  }

  function continueWithAIRecommendation() {
    setNotice({ kind: "info", message: "추천 설정이 적용됐어요. 저장 전에 확인하거나 직접 수정해 주세요." });
    startCreating();
  }

  function startAIRecommendation() {
    setAiQuestionSignal((signal) => signal + 1);
    const section = document.getElementById("ai-recommendation");
    if (!section) return;
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    section.scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth", block: "start" });
  }

  if (queryToken) {
    return (
      <>
        <header className="app-shell topbar">
          <button className="brand" type="button" onClick={() => (window.location.href = "/")} aria-label="내 방식 QR 첫 화면으로">
            <span className="brand-mark"><QrCode size={22} aria-hidden="true" /></span>
            <span className="brand-copy">
              <strong>내 방식 QR</strong>
              <span>어디서나 편안하게</span>
            </span>
          </button>
          <span className="topbar-note"><LockKeyhole size={16} aria-hidden="true" /> 설정 확인 전용</span>
        </header>
        <main className="app-shell public-wrap">
          <div className="public-heading">
            <span className="eyebrow">내 방식 QR · 공개 설정</span>
            <h1>이 키오스크에 적용할<br />편안한 설정이에요</h1>
            <p>이 QR은 설정을 확인하는 용도예요. 이 화면에서는 설정을 바꾸거나 관리할 수 없습니다.</p>
          </div>
          {publicLoading && (
            <div className="loading-card" role="status" aria-label="설정을 확인하는 중">
              <div className="loading-lines">
                <div className="skeleton wide" />
                <div className="skeleton medium" />
                <div className="skeleton" />
                <div className="skeleton medium" />
              </div>
            </div>
          )}
          {!publicLoading && publicError && (
            <div className="empty-card">
              <span className="empty-icon"><AlertCircle size={23} aria-hidden="true" /></span>
              <h2>설정을 불러오지 못했어요</h2>
              <p>{publicError}</p>
              <button className="btn btn-primary" type="button" onClick={() => setPublicRetry((value) => value + 1)}>
                다시 확인하기 <RotateCw size={17} aria-hidden="true" />
              </button>
            </div>
          )}
          {!publicLoading && publicProfile && (
            <>
              <div className="workspace public-workspace">
                <section className="panel settings-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>적용할 접근성 설정</h2>
                      <p>저장된 설정을 확인할 수 있어요. 변경과 관리는 프로필을 만든 분만 할 수 있습니다.</p>
                    </div>
                    <ShieldCheck size={23} color="#2864bd" aria-hidden="true" />
                  </div>
                  <PreferenceSummary preferences={publicProfile.preferences} />
                </section>
                <Preview preferences={publicProfile.preferences} />
              </div>
              <div className="public-privacy">
                <strong>안심하고 확인하세요.</strong> QR로 설정을 확인할 수 있지만, 설정을 바꾸거나 QR 사용을 중지할 수는 없어요.
              </div>
            </>
          )}
        </main>
        <footer className="app-shell footer">
          <span>내 방식 QR</span>
          <span>누구나 편하게 이용할 수 있도록</span>
        </footer>
      </>
    );
  }

  const isManagedActive = Boolean(saved && managed?.active);
  const shouldDisableForm = busy || managedLoading || Boolean(saved && (managedError || !managed));
  const buttonLabel = busy
    ? "저장하는 중…"
    : isManagedActive
      ? "변경한 설정 저장하기"
      : managed && !managed.active
        ? "새 QR 만들기"
        : "내 QR 만들기";

  return (
    <>
      <header className="app-shell topbar">
        <button className="brand" type="button" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })} aria-label="내 방식 QR 첫 화면으로">
          <span className="brand-mark"><QrCode size={22} aria-hidden="true" /></span>
          <span className="brand-copy">
            <strong>내 방식 QR</strong>
            <span>어디서나 편안하게</span>
          </span>
        </button>
        <span className="topbar-note"><ShieldCheck size={16} aria-hidden="true" /> 가입 없이, 내 설정으로</span>
      </header>

      <main>
        <section className="app-shell intro">
          <div className="intro-copy">
            <h1>한 번 정한 내 방식,<br /><em>어디서나 그대로.</em></h1>
            <p>
              글씨와 버튼, 안내 방식을 내게 맞게 정하고 QR로 다른 곳에서도 이어서 사용해요.
            </p>
            <div className="intro-actions">
              <button className="btn btn-primary" type="button" onClick={startCreating}>
                {isManagedActive ? "내 설정 살펴보기" : saved && managed && !managed.active ? "새 QR 만들기" : "내 설정 만들기"}
                <ArrowRight size={18} aria-hidden="true" />
              </button>
              {saved && managed?.active && (
                <button className="btn btn-secondary" type="button" onClick={scrollToQr}>
                  내 QR 보기 <QrCode size={17} aria-hidden="true" />
                </button>
              )}
              <button className="btn btn-ai" type="button" onClick={startAIRecommendation}>
                AI 추천받기 <Sparkles size={17} aria-hidden="true" />
              </button>
            </div>
            <div className="intro-note">
              <LockKeyhole size={16} aria-hidden="true" />
              가입이나 앱 설치 없이 사용할 수 있어요. 내 설정은 기기에 저장해 관리합니다.
            </div>
          </div>
        </section>

        <section className="app-shell steps" aria-label="이용 방법">
          <div className="step">
            <span className="step-number">1</span>
            <div><strong>내게 맞게 고르기</strong><span>화면을 보며 직접 고르거나, AI 추천을 받아 편한 설정을 찾으세요.</span></div>
          </div>
          <div className="step">
            <span className="step-number">2</span>
            <div><strong>QR로 저장하기</strong><span>완료된 QR 이미지를 휴대폰에 보관해요.</span></div>
          </div>
          <div className="step">
            <span className="step-number">3</span>
            <div><strong>다른 곳에서 열기</strong><span>QR을 읽으면 내 설정을 다시 사용할 수 있어요.</span></div>
          </div>
        </section>

        <section className="app-shell ai-recommendation-section" id="ai-recommendation" aria-label="설정 시작 방법">
          <AIRecommendationFlow
            getSettingsSnapshot={() => preferences}
            onRecommendationReady={applyAIRecommendation}
            onContinue={continueWithAIRecommendation}
            onDirect={startCreating}
            openQuestionsSignal={aiQuestionSignal}
          />
        </section>

        {!aiResultActive && <section className="app-shell workspace" id="profile-builder" tabIndex={-1}>
          <section className="panel settings-panel" aria-labelledby="builder-title">
            <div className="panel-heading">
              <div>
                <h2 id="builder-title">{isManagedActive ? "내 설정 관리하기" : "나에게 편한 설정 고르기"}</h2>
                <p>모르는 항목은 기본으로 두어도 괜찮아요. 설정은 언제든 바꿀 수 있습니다.</p>
              </div>
              <Accessibility size={24} color="#2864bd" aria-hidden="true" />
            </div>
            {managedLoading && saved && (
              <div className="feedback info" role="status">
                <CircleHelp size={18} aria-hidden="true" />
                <span>이 기기에 저장한 프로필을 안전하게 불러오고 있어요.</span>
              </div>
            )}
            {saved && managedError && (
              <div className="save-block">
                <Feedback notice={{ kind: "error", message: "이 기기에 저장된 QR 정보를 확인하지 못했어요. 다시 불러와 주세요." }} />
                <button className="btn btn-secondary" type="button" disabled={managedLoading} onClick={() => setManagedRetry((value) => value + 1)}>
                  다시 불러오기 <RotateCw size={17} aria-hidden="true" />
                </button>
              </div>
            )}
            <SettingsForm
              preferences={preferences}
              onPreferenceChange={changePreference}
              disabled={shouldDisableForm}
            />
            <div className="save-block">
              {notice && (
                <div className="notice-actions">
                  <Feedback notice={notice} />
                  {notice.kind === "success" && managed?.active && (
                    <button className="btn btn-secondary qr-jump" type="button" onClick={scrollToQr}>
                      내 QR 보러가기 <QrCode size={17} aria-hidden="true" />
                    </button>
                  )}
                </div>
              )}
              {saved && managed && !managed.active && (
                <Feedback notice={{ kind: "info", message: "기존 QR 사용을 중지했어요. 저장하면 새 QR을 만들 수 있어요." }} />
              )}
              <button className="btn btn-primary" type="button" disabled={shouldDisableForm} onClick={savePreferences}>
                {buttonLabel}
                {busy ? <span aria-hidden="true">…</span> : <ArrowRight size={18} aria-hidden="true" />}
              </button>
              <div className="privacy-note">
                <ShieldCheck size={16} aria-hidden="true" />
                {isManagedActive
                  ? "변경 사항은 저장을 눌렀을 때만 QR 프로필에 반영됩니다."
                  : "설정 생성에는 가입이 필요하지 않아요. 연결이 되지 않으면 성공한 것으로 처리하지 않습니다."}
              </div>
            </div>
          </section>
          <Preview preferences={preferences} />
        </section>}

        {(managedLoading && saved) && (
          <section className="app-shell management-area" aria-label="저장한 프로필 불러오기">
            <SkeletonCard />
          </section>
        )}
        {saved && managed && (
          <section className="app-shell management-area" id="my-profile" aria-labelledby="manage-title">
            <div className="management-card">
              <div>
                <h2 id="manage-title">내 QR 관리하기</h2>
                <p>
                  {managed.active
                    ? "내 QR을 만들었어요! 이 QR을 사용하면 다른 키오스크에서도 내가 고른 설정을 불러올 수 있어요."
                    : "기존 QR 사용을 중지했어요. 새 QR을 만들면 다른 곳에서 설정을 다시 불러올 수 있어요."}
                </p>
                <div className={`management-status ${managed.active ? "" : "inactive"}`}>
                  {managed.active ? "QR 사용 가능" : "QR 사용 중지됨"}
                </div>
                <p>지금 사용 중인 기기에서 설정을 바꾸거나 새 QR을 만들 수 있어요.</p>
                <p>
                  {managed.active
                    ? "다른 기기에서는 QR로 설정을 확인할 수 있지만, 설정을 바꾸거나 QR을 없앨 수는 없어요."
                    : "새 QR을 만들기 전에는 다른 기기에서 설정을 불러올 수 없어요."}
                </p>
                <details className="security-details">
                  <summary>자세히 알아보기</summary>
                  <p>
                    QR을 공유해도 설정 확인만 할 수 있어요. 설정 변경, 새 QR 만들기, 기존 QR 사용 중지는 QR을 만든 기기에서만 할 수 있습니다.
                  </p>
                </details>
              </div>
              <div className="management-actions">
                {managed.active && (
                  <>
                    <button className="btn btn-secondary" type="button" disabled={busy} onClick={rotateQr}>
                      새 QR 만들기 <RotateCw size={17} aria-hidden="true" />
                    </button>
                    <button className="btn btn-danger" type="button" disabled={busy} onClick={revokeQr}>
                      기존 QR 사용 중지 <FileKey2 size={17} aria-hidden="true" />
                    </button>
                  </>
                )}
                {!managed.active && (
                  <button className="btn btn-primary" type="button" onClick={startCreating}>
                    새 QR 만들기 <ArrowRight size={17} aria-hidden="true" />
                  </button>
                )}
              </div>
            </div>
            {managed.active && (
              <section className="qr-card" id="my-qr" tabIndex={-1} aria-labelledby="qr-title">
                <div className="qr-visual">
                  <div className="qr-image">
                    {qrDataUrl ? (
                      <img src={qrDataUrl} alt="내 설정을 불러오는 QR 코드" />
                    ) : (
                      <div className="qr-placeholder" role="status">
                        {publicAppConfigError || qrGenerationError || (publicAppConfig ? "QR을 준비하는 중…" : "주소를 확인하는 중…")}
                      </div>
                    )}
                  </div>
                  <button className="btn btn-secondary qr-download" type="button" disabled={!qrDataUrl} onClick={downloadQr}>
                    QR 이미지 저장 <ArrowDownToLine size={17} aria-hidden="true" />
                  </button>
                </div>
                <div className="qr-info">
                  <h3 id="qr-title">현재 사용 중인 QR</h3>
                  <p>이 QR을 읽으면 다른 키오스크에서도 내가 고른 설정을 불러올 수 있어요.</p>
                  {publicUrl && <span className="qr-url">{publicUrl}</span>}
                  {publicAppConfig?.isPreview && (
                    <p className="qr-preview-warning" role="note">
                      개발 Preview QR은 Replit 로그인 화면이 보이거나 개발 데이터가 공개 환경에 없어 열리지 않을 수 있어요. 공개 배포 후 공개 사이트에서 새 QR을 만들어 주세요.
                    </p>
                  )}
                  <p className="qr-stale-note">
                    이미 저장하거나 인쇄한 QR 이미지는 주소가 바뀌어도 자동으로 바뀌지 않아요. 공개 배포 후에는 새 QR 이미지를 다시 저장해 주세요.
                  </p>
                </div>
              </section>
            )}
          </section>
        )}
        {saved && managedError && !managedLoading && (
          <section className="app-shell management-area">
            <div className="empty-card">
              <span className="empty-icon"><KeyRound size={23} aria-hidden="true" /></span>
              <h2>QR 정보를 다시 확인해 주세요</h2>
              <p>이 기기에 저장된 QR 정보를 확인하지 못했어요. 네트워크를 확인하고 다시 불러와 주세요.</p>
              <button className="btn btn-secondary" type="button" onClick={() => setManagedRetry((value) => value + 1)}>
                다시 불러오기 <RotateCw size={17} aria-hidden="true" />
              </button>
            </div>
          </section>
        )}
      </main>

      <footer className="app-shell footer">
        <span>내 방식 QR</span>
        <span>내게 편한 설정을, 필요한 곳에서.</span>
      </footer>
    </>
  );
}

function PreferenceSummary({ preferences }: { preferences: ProfilePreferences }) {
  const values: { label: string; value: string; icon: typeof Type }[] = [
    {
      label: "글씨 크기",
      value: preferences.textSize === "standard" ? "기본" : preferences.textSize === "large" ? "크게" : "아주 크게",
      icon: Type,
    },
    { label: "버튼 크기", value: preferences.buttonSize === "large" ? "크게" : "기본", icon: Accessibility },
    { label: "화면 대비", value: preferences.contrast === "high" ? "고대비" : "기본", icon: Monitor },
    { label: "쉬운 말", value: preferences.easyLanguage ? "사용" : "사용 안 함", icon: Check },
    { label: "하단 조작 모드", value: preferences.viewportMode ? `아래쪽 ${preferences.viewportMode.heightPercent}%` : "사용하지 않음", icon: ArrowDownToLine },
    { label: "스마트 길잡이", value: preferences.smartGuide ? `사용 · ${preferences.guideDelaySeconds}초 후` : "사용 안 함", icon: CircleHelp },
    { label: "음성 안내", value: preferences.voiceGuidance ? "사용" : "사용 안 함", icon: Volume2 },
  ];
  return (
    <div className="preference-summary">
      {values.map(({ label, value, icon: Icon }) => (
        <div className="summary-item" key={label}>
          <span className="summary-icon"><Icon size={17} aria-hidden="true" /></span>
          <span className="summary-label">{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  );
}
