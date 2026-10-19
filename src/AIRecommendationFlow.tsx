import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, Check, LoaderCircle, Sparkles } from "lucide-react";
import type { ProfilePreferences } from "./lib/profile";

type AIRecommendationFlowProps = {
  getSettingsSnapshot: () => ProfilePreferences;
  onRecommendationReady: (
    preferences: ProfilePreferences,
    reasons: string[],
    settingsAtRequestStart: ProfilePreferences,
  ) => boolean;
  onContinue: () => void;
  onDirect: () => void;
  openQuestionsSignal: number;
};

type RecommendationResponse = {
  preferences: ProfilePreferences;
  reasons: string[];
};

type AgeGroupId = "under20" | "30to50" | "60s" | "70s" | "80plus";
type LanguageId = "ko" | "zh" | "vi" | "en" | "th" | "uz" | "ja";
type VisualIssueId = "smallText" | "lowClarity" | "smallButtons" | "topOutOfReach" | "unsureNext";
type UsageIssueId = "difficultWords" | "unsureSteps" | "needsMoreTime" | "prefersVoice";

type FormAnswers = {
  ageGroup: AgeGroupId | "";
  preferredLanguage: LanguageId | "";
  visualIssues: VisualIssueId[];
  usageIssues: UsageIssueId[];
  scrollGuidance: "" | "yes" | "no";
  freeText: string;
};

const ageOptions: { label: string; value: AgeGroupId | "" }[] = [
  { label: "20대 이하", value: "under20" },
  { label: "30~50대", value: "30to50" },
  { label: "60대", value: "60s" },
  { label: "70대", value: "70s" },
  { label: "80대 이상", value: "80plus" },
  { label: "선택하지 않을래요", value: "" },
];
const languageOptions: { label: string; value: LanguageId }[] = [
  { label: "한국어", value: "ko" },
  { label: "中文", value: "zh" },
  { label: "Tiếng Việt", value: "vi" },
  { label: "English", value: "en" },
  { label: "ภาษาไทย", value: "th" },
  { label: "Oʻzbekcha", value: "uz" },
  { label: "日本語", value: "ja" },
];
const visualOptions = [
  { label: "작은 글씨가 잘 안 보여요.", value: "smallText" as const },
  { label: "글씨나 그림이 선명하지 않아요.", value: "lowClarity" as const },
  { label: "버튼이 작아서 누르기 어려워요.", value: "smallButtons" as const },
  { label: "화면 위쪽까지 손이 닿지 않아요.", value: "topOutOfReach" as const },
  { label: "어떤 버튼을 눌러야 할지 모르겠어요.", value: "unsureNext" as const },
];
const usageOptions = [
  { label: "어려운 단어가 많아요.", value: "difficultWords" as const },
  { label: "무엇부터 해야 할지 헷갈려요.", value: "unsureSteps" as const },
  { label: "화면에 나온 내용을 이해하는 데 시간이 오래 걸려요.", value: "needsMoreTime" as const },
  { label: "글보다 말로 알려주는 게 편해요.", value: "prefersVoice" as const },
];

const emptyAnswers: FormAnswers = {
  ageGroup: "",
  preferredLanguage: "",
  visualIssues: [],
  usageIssues: [],
  scrollGuidance: "",
  freeText: "",
};

function toggleItem<T extends string>(items: T[], item: T) {
  return items.includes(item) ? items.filter((value) => value !== item) : [...items, item];
}

export default function AIRecommendationFlow({
  getSettingsSnapshot,
  onRecommendationReady,
  onContinue,
  onDirect,
  openQuestionsSignal,
}: AIRecommendationFlowProps) {
  const [step, setStep] = useState<"paths" | "questions" | "result">("paths");
  const [answers, setAnswers] = useState<FormAnswers>(emptyAnswers);
  const [recommendation, setRecommendation] = useState<RecommendationResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const submitting = useRef(false);
  const requestSequence = useRef(0);
  const requestController = useRef<AbortController | null>(null);
  const lastOpenQuestionsSignal = useRef(openQuestionsSignal);
  const resultHeadingRef = useRef<HTMLHeadingElement>(null);

  useLayoutEffect(() => {
    if (step !== "result" || !recommendation) return;
    const frame = window.requestAnimationFrame(() => {
      const heading = resultHeadingRef.current;
      if (!heading) return;
      heading.focus({ preventScroll: true });
      const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      heading.scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth", block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [step, recommendation]);

  function cancelPendingRequest() {
    requestSequence.current += 1;
    requestController.current?.abort();
    requestController.current = null;
    submitting.current = false;
    setLoading(false);
  }

  useEffect(() => {
    if (lastOpenQuestionsSignal.current === openQuestionsSignal) return;
    lastOpenQuestionsSignal.current = openQuestionsSignal;
    requestSequence.current += 1;
    requestController.current?.abort();
    requestController.current = null;
    submitting.current = false;
    setLoading(false);
    setError("");
    setNotice("");
    setStep("questions");
  }, [openQuestionsSignal]);

  useEffect(
    () => () => {
      requestSequence.current += 1;
      requestController.current?.abort();
    },
    [],
  );

  async function submitAnswers(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    const requestId = ++requestSequence.current;
    const controller = new AbortController();
    requestController.current = controller;
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 30_000);
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const currentSettings = getSettingsSnapshot();
      const settingsAtRequestStart: ProfilePreferences = {
        ...currentSettings,
        viewportMode: currentSettings.viewportMode ? { ...currentSettings.viewportMode } : null,
      };
      const response = await fetch("/api/recommendations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          ageGroup: answers.ageGroup || null,
          preferredLanguage: answers.preferredLanguage || null,
          visualIssues: answers.visualIssues,
          usageIssues: answers.usageIssues,
          scrollGuidance: answers.scrollGuidance === "yes" ? true : answers.scrollGuidance === "no" ? false : null,
          freeText: answers.freeText.trim() || null,
        }),
      });
      if (requestId !== requestSequence.current) return;
      const payload = await response.json().catch(() => null) as
        | (Partial<RecommendationResponse> & { error?: string })
        | null;
      if (requestId !== requestSequence.current) return;
      if (!response.ok) {
        throw new Error(
          payload?.error ||
          "입력한 내용을 처리하지 못했어요. 민감한 개인정보는 빼고 다시 시도해 주세요.",
        );
      }
      if (
        !payload ||
        !payload.preferences ||
        !Array.isArray(payload.reasons) ||
        payload.reasons.length < 2 ||
        payload.reasons.length > 4 ||
        !payload.reasons.every((reason) => typeof reason === "string" && reason.trim().length > 0)
      ) {
        throw new Error("추천 결과를 확인하지 못했어요. 다시 시도해 주세요.");
      }
      const preferences = payload.preferences as ProfilePreferences;
      if (!onRecommendationReady(preferences, payload.reasons, settingsAtRequestStart)) {
        if (requestId === requestSequence.current) {
          setNotice("요청하는 동안 설정이 변경되어 추천을 표시하지 않았어요. 현재 설정을 유지하고 직접 설정을 계속할 수 있어요.");
          setStep("questions");
        }
        return;
      }
      setRecommendation({
        preferences,
        reasons: payload.reasons,
      });
      setStep("result");
    } catch (requestError) {
      if (requestId !== requestSequence.current || controller.signal.aborted && !timedOut) return;
      setError(
        timedOut
          ? "요청 시간이 초과되었어요. 현재 설정은 그대로예요. 다시 시도하거나 직접 설정해 주세요."
          : requestError instanceof Error
          ? requestError.message
          : "추천을 불러오지 못했어요. 연결을 확인하고 다시 시도해 주세요.",
      );
    } finally {
      window.clearTimeout(timeout);
      if (requestId === requestSequence.current) {
        requestController.current = null;
        submitting.current = false;
        setLoading(false);
      }
    }
  }

  function returnToQuestions() {
    setStep("questions");
    setError("");
    setNotice("");
  }

  function returnToPaths() {
    cancelPendingRequest();
    setError("");
    setNotice("");
    setStep("paths");
  }

  function chooseDirectSetup() {
    cancelPendingRequest();
    onDirect();
  }

  return (
    <section className="air-flow" aria-labelledby="air-title">
      <header className="air-heading">
        <span className="air-kicker"><Sparkles size={16} aria-hidden="true" /> 내 방식 QR</span>
        <h2 id="air-title">나에게 편한 방법을 찾아볼까요?</h2>
        <p>원하는 방법을 골라 주세요. 질문은 모두 선택 사항이에요.</p>
      </header>

      {step === "paths" && (
        <div className="air-paths">
          <button
            type="button"
            className="air-path air-path-featured"
            onClick={returnToQuestions}
          >
            <span className="air-path-mark" aria-hidden="true"><Sparkles size={21} /></span>
            <span className="air-path-copy">
              <strong>AI 추천받기</strong>
              <span>몇 가지 질문에 답하면 나에게 맞는 설정을 추천해 드려요.</span>
            </span>
            <ArrowRight className="air-path-arrow" size={20} aria-hidden="true" />
          </button>
          <button type="button" className="air-path" onClick={chooseDirectSetup}>
            <span className="air-path-mark air-path-mark-direct" aria-hidden="true"><ArrowRight size={20} /></span>
            <span className="air-path-copy">
              <strong>직접 설정하기</strong>
              <span>글씨와 버튼 크기 등을 내가 직접 고를 수 있어요.</span>
            </span>
            <ArrowRight className="air-path-arrow" size={20} aria-hidden="true" />
          </button>
        </div>
      )}

      {step === "questions" && (
        <form className="air-form" onSubmit={submitAnswers}>
          <div className="air-form-top">
            <button className="air-back" type="button" onClick={returnToPaths}>
              <ArrowLeft size={17} aria-hidden="true" /> 방법 다시 고르기
            </button>
            <span>모두 선택 사항</span>
          </div>

          <fieldset className="air-question">
            <legend>① 연령대를 알려주세요.</legend>
            <div className="air-option-grid air-age-options">
              {ageOptions.map((option) => (
                <label className="air-choice" key={option.label}>
                  <input
                    type="radio"
                    name="air-age"
                    value={option.value}
                    checked={answers.ageGroup === option.value}
                    onChange={() => setAnswers((current) => ({ ...current, ageGroup: option.value }))}
                  />
                  <span className="air-choice-indicator" aria-hidden="true" />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="air-question">
            <legend>② 어떤 언어로 안내받고 싶으신가요?</legend>
            <p className="air-help">
              이 외의 언어는 추후 추가할 예정입니다. 언어는 QR 설정에 저장돼요.
            </p>
            <div className="air-option-grid air-language-options">
              {languageOptions.map((option) => (
                <label className="air-choice" key={option.value}>
                  <input
                    type="radio"
                    name="air-language"
                    value={option.value}
                    checked={answers.preferredLanguage === option.value}
                    onChange={() =>
                      setAnswers((current) => ({ ...current, preferredLanguage: option.value }))
                    }
                  />
                  <span className="air-choice-indicator" aria-hidden="true" />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="air-question">
            <legend>③ 키오스크 화면을 보거나 누를 때 어떤 점이 불편한가요?</legend>
            <p className="air-help">해당하는 내용을 모두 골라 주세요.</p>
            <div className="air-check-list">
              {visualOptions.map((option) => (
                <label className="air-choice air-check-choice" key={option.value}>
                  <input
                    type="checkbox"
                    checked={answers.visualIssues.includes(option.value)}
                    onChange={() =>
                      setAnswers((current) => ({
                        ...current,
                        visualIssues: toggleItem(current.visualIssues, option.value),
                      }))
                    }
                  />
                  <span className="air-choice-indicator" aria-hidden="true"><Check size={14} /></span>
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="air-question">
            <legend>④ 키오스크를 사용할 때 어떤 점이 어렵거나 불편한가요?</legend>
            <p className="air-help">해당하는 내용을 모두 골라 주세요.</p>
            <div className="air-check-list">
              {usageOptions.map((option) => (
                <label className="air-choice air-check-choice" key={option.value}>
                  <input
                    type="checkbox"
                    checked={answers.usageIssues.includes(option.value)}
                    onChange={() =>
                      setAnswers((current) => ({
                        ...current,
                        usageIssues: toggleItem(current.usageIssues, option.value),
                      }))
                    }
                  />
                  <span className="air-choice-indicator" aria-hidden="true"><Check size={14} /></span>
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="air-question">
            <legend>⑤ 화면 아래에 더 볼 내용이 있다는 안내가 필요하신가요?</legend>
            <div className="air-option-grid">
              {[
                { label: "네, 필요해요.", value: "yes" as const },
                { label: "아니요, 필요하지 않아요.", value: "no" as const },
              ].map((option) => (
                <label className="air-choice" key={option.value}>
                  <input
                    type="radio"
                    name="air-scroll-guidance"
                    value={option.value}
                    checked={answers.scrollGuidance === option.value}
                    onChange={() => setAnswers((current) => ({ ...current, scrollGuidance: option.value }))}
                  />
                  <span className="air-choice-indicator" aria-hidden="true" />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="air-question air-free-text">
            <label htmlFor="air-free-text">더 알려주고 싶은 점이 있나요?</label>
            <p className="air-help">없다면 비워두셔도 돼요.</p>
            <textarea
              id="air-free-text"
              maxLength={300}
              value={answers.freeText}
              placeholder="작은 글씨는 불편하지만 설명은 짧은 게 좋아요."
              onChange={(event) =>
                setAnswers((current) => ({ ...current, freeText: event.target.value }))
              }
            />
            <span className="air-character-count" aria-live="polite">{answers.freeText.length}/300</span>
          </div>

          {error && (
            <div className="air-error" role="alert">
              <p>{error}</p>
              <button type="button" className="air-back" onClick={chooseDirectSetup}>
                직접 설정하기 <ArrowRight size={16} aria-hidden="true" />
              </button>
            </div>
          )}
          {notice && (
            <div className="air-notice" role="status">
              <p>{notice}</p>
              <button type="button" className="air-back" onClick={chooseDirectSetup}>
                직접 설정하기 <ArrowRight size={16} aria-hidden="true" />
              </button>
            </div>
          )}
          <div className="air-submit-row">
            <button className="air-submit" type="submit" disabled={loading}>
              {loading ? (
                <><LoaderCircle className="air-loading-icon" size={19} aria-hidden="true" /> 추천을 준비하고 있어요…</>
              ) : (
                <>내 설정 추천받기 <ArrowRight size={18} aria-hidden="true" /></>
              )}
            </button>
            <p className="air-privacy-note">
              답변은 AI 추천을 위해 OpenAI로 전송되며, 이 서비스 DB에는 저장하지 않아요.
              OpenAI 기본 API 정책에 따라 남용 방지 로그에 최대 30일 보관될 수 있어요.
              카드·계좌·인증 정보는 입력하지 마세요.
            </p>
          </div>
        </form>
      )}

      {step === "result" && recommendation && (
        <section className="air-result" aria-labelledby="air-result-title">
          <span className="air-result-mark" aria-hidden="true"><Check size={23} /></span>
          <h3 id="air-result-title" ref={resultHeadingRef} tabIndex={-1}>나에게 맞는 설정을 준비했어요</h3>
          <p className="air-result-intro">이런 점을 생각해 추천했어요.</p>
          {recommendation.reasons.length > 0 ? (
            <ul className="air-reasons">
              {recommendation.reasons.map((reason, index) => <li key={`${reason}-${index}`}>{reason}</li>)}
            </ul>
          ) : (
            <p className="air-no-reasons">입력한 내용을 바탕으로 설정을 추천했어요.</p>
          )}
          <p className="air-edit-note">적용한 뒤에도 설정을 직접 바꿀 수 있어요.</p>
          <button
            type="button"
            className="air-submit"
            onClick={onContinue}
          >
            이 설정 사용하기 <ArrowRight size={18} aria-hidden="true" />
          </button>
          <div className="air-result-links">
            <button type="button" className="air-back" onClick={returnToQuestions}>
              <ArrowLeft size={16} aria-hidden="true" /> 답변 다시 보기
            </button>
            <button type="button" className="air-back" onClick={chooseDirectSetup}>
              직접 설정하기 <ArrowRight size={16} aria-hidden="true" />
            </button>
          </div>
        </section>
      )}
    </section>
  );
}
