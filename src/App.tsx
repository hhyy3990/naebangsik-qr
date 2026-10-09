import { useEffect, useMemo, useState } from "react";
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
import {
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

const STORAGE_KEY = "myway-qr-managed-profile";

const DEFAULT_PREFERENCES: ProfilePreferences = {
  textSize: "standard",
  buttonSize: "standard",
  contrast: "standard",
  easyLanguage: false,
  simplifiedLayout: false,
  bottomControls: false,
  smartGuide: false,
  guideDelaySeconds: 15,
  voiceGuidance: false,
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
      <ToggleRow
        title="화면 구성을 단순하게"
        description="필요한 정보와 선택지만 간결하게 보여요."
        checked={preferences.simplifiedLayout}
        onChange={(value) => onPreferenceChange("simplifiedLayout", value)}
      />
      <ToggleRow
        title="하단 조작 모드"
        description="자주 쓰는 버튼을 화면 아래쪽에 모아요."
        checked={preferences.bottomControls}
        onChange={(value) => onPreferenceChange("bottomControls", value)}
      />

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
    </fieldset>
  );
}

function Preview({ preferences }: { preferences: ProfilePreferences }) {
  const classNames = [
    "kiosk-screen",
    `text-${preferences.textSize}`,
    `button-${preferences.buttonSize}`,
    `contrast-${preferences.contrast}`,
    preferences.easyLanguage ? "easy-language" : "",
    preferences.bottomControls ? "bottom-controls" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const options = preferences.simplifiedLayout
    ? ["주문 시작", "직원 도움 요청"]
    : ["메뉴 보기", "주문 조회", "직원 도움 요청"];
  return (
    <aside className="panel preview-panel" aria-label="설정 미리보기">
      <div className="preview-head">
        <h3>설정 미리보기</h3>
        <span className="preview-live">바로 반영</span>
      </div>
      <div className="preview-stage">
        <div className={classNames}>
          <div className="kiosk-inner">
            <div className="kiosk-header">
              <span>이음 키오스크</span>
              <span>{preferences.voiceGuidance ? "음성 안내 켜짐" : "화면 안내"}</span>
            </div>
            <h4>무엇을 도와드릴까요?</h4>
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
          </div>
          {preferences.bottomControls && (
            <div className="kiosk-footer">
              <span>이전</span>
              <span>다음</span>
            </div>
          )}
        </div>
        <p className="preview-caption">
          선택한 설정이 어떻게 보이는지 미리 확인할 수 있어요. 실제 키오스크 적용 화면과 다를 수 있습니다.
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
  const [busy, setBusy] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState("");

  const publicUrl = useMemo(() => {
    if (!saved?.token) return "";
    return `${window.location.origin}/?token=${encodeURIComponent(saved.token)}`;
  }, [saved?.token]);

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
      setQrDataUrl("");
      return;
    }
    QRCode.toDataURL(publicUrl, {
      width: 320,
      margin: 2,
      errorCorrectionLevel: "M",
      color: { dark: "#20324c", light: "#fffefa" },
    })
      .then((dataUrl) => {
        if (current) setQrDataUrl(dataUrl);
      })
      .catch(() => {
        if (current) setQrDataUrl("");
      });
    return () => {
      current = false;
    };
  }, [publicUrl]);

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
        setNotice({ kind: "success", message: "프로필을 만들었어요. 아래 QR을 저장하거나 언제든 다시 불러올 수 있습니다." });
      }
    } catch (error) {
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "저장하지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function revokeQr() {
    if (!saved || !managed?.active) return;
    const confirmed = window.confirm(
      "이전 QR을 폐기할까요? 이 QR을 연 사람은 더 이상 설정을 불러올 수 없습니다.",
    );
    if (!confirmed) return;
    setBusy(true);
    setNotice(null);
    try {
      await profileApi.revoke(saved.id, saved.managementKey);
      setManaged({ ...managed, active: false });
      setNotice({ kind: "success", message: "이전 QR을 폐기했어요. 기존 QR 링크는 더 이상 설정을 보여주지 않습니다." });
    } catch (error) {
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "QR을 폐기하지 못했어요. 다시 시도해 주세요.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function rotateQr() {
    if (!saved || !managed?.active) return;
    const confirmed = window.confirm(
      "새 QR을 발급할까요? 지금까지 사용한 QR은 더 이상 작동하지 않습니다.",
    );
    if (!confirmed) return;
    setBusy(true);
    setNotice(null);
    try {
      const result = await profileApi.rotate(saved.id, saved.managementKey);
      persistStoredProfile({ ...saved, token: result.token });
      setNotice({ kind: "success", message: "새 QR을 발급했어요. 이전 QR은 폐기되었고 아래에서 새 이미지를 저장할 수 있습니다." });
    } catch (error) {
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "새 QR을 발급하지 못했어요. 다시 시도해 주세요.",
      });
    } finally {
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

  function startCreating() {
    document.getElementById("profile-builder")?.scrollIntoView({ behavior: "smooth", block: "start" });
    document.getElementById("profile-builder")?.focus({ preventScroll: true });
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
                <strong>안심하고 확인하세요.</strong> 이 링크에는 설정을 읽는 권한만 있어요. 관리 코드나 개인 정보는 QR에 포함되지 않습니다.
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
        ? "새 QR 프로필 만들기"
        : "이 설정으로 QR 프로필 만들기";

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
                {isManagedActive ? "내 설정 살펴보기" : saved && managed && !managed.active ? "새 프로필 만들기" : "내 설정 만들기"}
                <ArrowRight size={18} aria-hidden="true" />
              </button>
              {saved && managed?.active && (
                <button className="btn btn-secondary" type="button" onClick={() => document.getElementById("my-profile")?.scrollIntoView({ behavior: "smooth" })}>
                  QR과 관리 보기 <QrCode size={17} aria-hidden="true" />
                </button>
              )}
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
            <div><strong>내게 맞게 고르기</strong><span>화면을 보며 편한 설정을 선택해요.</span></div>
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

        <section className="app-shell workspace" id="profile-builder" tabIndex={-1}>
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
                <Feedback notice={{ kind: "error", message: `저장한 프로필을 불러오지 못했어요. ${managedError}` }} />
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
              {notice && <Feedback notice={notice} />}
              {saved && managed && !managed.active && (
                <Feedback notice={{ kind: "info", message: "이 프로필의 QR은 폐기되었습니다. 저장하면 새 QR 프로필을 만들 수 있어요." }} />
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
        </section>

        {(managedLoading && saved) && (
          <section className="app-shell management-area" aria-label="저장한 프로필 불러오기">
            <SkeletonCard />
          </section>
        )}
        {saved && managed && (
          <section className="app-shell management-area" id="my-profile" aria-labelledby="manage-title">
            <div className="management-card">
              <div>
                <span className="eyebrow">이 기기에 저장된 프로필</span>
                <h2 id="manage-title">내 QR과 관리</h2>
                <p>
                  이 기기에 프로필 관리 정보가 저장되어 있어요. QR은 설정을 읽는 용도이며, 변경·폐기에는 관리 코드가 필요합니다.
                </p>
                <div className={`management-status ${managed.active ? "" : "inactive"}`}>
                  {managed.active ? "현재 QR 사용 가능" : "QR 폐기됨"}
                </div>
                <div className="key-callout">
                  <strong>관리 코드는 QR 토큰과 달라요.</strong><br />
                  QR을 다른 사람과 공유해도 관리 권한은 전달되지 않습니다. 관리 코드는 이 기기에만 저장되며, 다른 기기에서는 프로필을 관리할 수 없어요.
                </div>
              </div>
              <div className="management-actions">
                {managed.active && (
                  <>
                    <button className="btn btn-secondary" type="button" disabled={busy} onClick={rotateQr}>
                      새 QR로 재발급 <RotateCw size={17} aria-hidden="true" />
                    </button>
                    <button className="btn btn-danger" type="button" disabled={busy} onClick={revokeQr}>
                      이전 QR 폐기 <FileKey2 size={17} aria-hidden="true" />
                    </button>
                  </>
                )}
                {!managed.active && (
                  <button className="btn btn-primary" type="button" onClick={startCreating}>
                    새 프로필 만들기 <ArrowRight size={17} aria-hidden="true" />
                  </button>
                )}
              </div>
            </div>
            {managed.active && (
              <div className="qr-card">
                <div className="qr-image">
                  {qrDataUrl ? (
                    <img src={qrDataUrl} alt="현재 설정을 여는 QR 코드" />
                  ) : (
                    <div className="qr-placeholder" role="status">QR을 만드는 중…</div>
                  )}
                </div>
                <div>
                  <h3>현재 사용할 QR</h3>
                  <p>이 QR을 읽으면 현재 설정만 확인할 수 있어요. 기기에서 설정을 바꾸려면 관리 화면으로 돌아오세요.</p>
                  <span className="qr-url">{publicUrl}</span>
                  <button className="btn btn-secondary qr-download" type="button" disabled={!qrDataUrl} onClick={downloadQr}>
                    QR 이미지 저장 <ArrowDownToLine size={17} aria-hidden="true" />
                  </button>
                </div>
              </div>
            )}
          </section>
        )}
        {saved && managedError && !managedLoading && (
          <section className="app-shell management-area">
            <div className="empty-card">
              <span className="empty-icon"><KeyRound size={23} aria-hidden="true" /></span>
              <h2>관리 정보를 다시 확인해 주세요</h2>
              <p>현재 서버에서 프로필 상태를 확인하지 못했습니다. 네트워크를 확인하고 다시 불러오면 이어서 관리할 수 있어요.</p>
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
    { label: "화면 구성 단순화", value: preferences.simplifiedLayout ? "사용" : "사용 안 함", icon: Sparkles },
    { label: "하단 조작 모드", value: preferences.bottomControls ? "사용" : "사용 안 함", icon: ArrowDownToLine },
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
