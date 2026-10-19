import { test } from "node:test";
import assert from "node:assert/strict";
import type OpenAI from "openai";
import request from "supertest";
import type { Pool } from "pg";
import { createApp } from "./app";
import {
  parseRecommendationOutput,
  recommendAccessibility,
  validateRecommendation,
  type RecommendationInput,
  type RecommendationResult,
} from "./recommendation";

const input: RecommendationInput = {
  ageGroup: "70s",
  preferredLanguage: "ko",
  visualIssues: ["smallText", "topOutOfReach"],
  usageIssues: ["difficultWords"],
  scrollGuidance: null,
  freeText: "작은 글씨는 불편하지만 설명은 짧은 게 좋아요.",
};

const result: RecommendationResult = {
  preferences: {
    textSize: "large",
    buttonSize: "standard",
    contrast: "standard",
    easyLanguage: true,
    smartGuide: false,
    guideDelaySeconds: 15,
    voiceGuidance: false,
    language: "ko",
    stepByStepGuidance: false,
    conciseGuidance: false,
    slowGuidance: false,
    scrollGuidance: false,
    viewportMode: { mode: "bottom", heightPercent: 70 },
  },
  reasons: [
    "작은 글씨와 위쪽 버튼이 불편하다고 하셔서 글씨를 키우고 조작 영역을 아래로 옮겼어요.",
    "어려운 단어가 많다고 하셔서 쉬운 말 안내를 켰어요.",
  ],
};
const modelResult = {
  preferences: result.preferences,
  reasons: [
    { text: result.reasons[0], basedOn: ["smallText", "topOutOfReach"] },
    { text: result.reasons[1], basedOn: ["difficultWords"] },
  ],
};

test("recommendation rejects sensitive free text before any model call", () => {
  assert.throws(() => validateRecommendation({ ...input, freeText: "카드번호 4111 1111 1111 1111" }), /SENSITIVE_INPUT/);
  assert.throws(() => validateRecommendation({ ...input, freeText: "010-1234-5678로 연락 주세요" }), /SENSITIVE_INPUT/);
  assert.throws(() => validateRecommendation({ ...input, freeText: "주민등록번호를 입력할게요" }), /SENSITIVE_INPUT/);
});

test("recommendation output is strict, current-v5 only, and rejects unsupported claims", () => {
  assert.deepEqual(parseRecommendationOutput(modelResult, input), result);
  assert.throws(() => parseRecommendationOutput({
    ...modelResult,
    preferences: { ...result.preferences, simplifiedLayout: false },
  }, input));
  assert.throws(() => parseRecommendationOutput({
    ...modelResult,
    reasons: [
      { text: "안내를 15초 동안 유지하도록 설정했어요.", basedOn: ["smallText"] },
      modelResult.reasons[1],
    ],
  }, input), /UNSUPPORTED_CLAIM/);
});

test("80대 이상과 작은 글씨 불편에는 extraLarge를 적용하고 이유도 실제 값과 일치시킨다", () => {
  const input80: RecommendationInput = {
    ageGroup: "80plus",
    preferredLanguage: "ko",
    visualIssues: ["smallText"],
    usageIssues: [],
    scrollGuidance: null,
    freeText: null,
  };
  const modelLarge = {
    ...modelResult,
    preferences: { ...result.preferences, textSize: "large" as const },
    reasons: [
      { text: "글씨를 크게 설정했어요.", basedOn: ["smallText"] },
      { text: "작은 글씨가 불편해요.", basedOn: ["smallText"] },
    ],
  };
  const recommended = parseRecommendationOutput(modelLarge, input80);
  assert.equal(recommended.preferences.textSize, "extraLarge");
  assert.match(recommended.reasons[0], /매우 크게/);

  const ageAlone = parseRecommendationOutput({
    ...modelLarge,
    reasons: modelLarge.reasons.map((reason) => ({ ...reason, basedOn: ["noSpecificPreference"] })),
  }, { ...input80, visualIssues: [] });
  assert.equal(ageAlone.preferences.textSize, "large");

  const conflict = parseRecommendationOutput({
    ...modelLarge,
    preferences: { ...modelLarge.preferences, textSize: "extraLarge" },
    reasons: [
      { text: "매우 크게 설정했어요.", basedOn: ["smallText"] },
      { text: "선택한 내용을 고려했어요.", basedOn: ["freeText"] },
    ],
  }, { ...input80, freeText: "큰 글씨는 오히려 불편해요." });
  assert.equal(conflict.preferences.textSize, "standard");
  assert.ok(conflict.reasons.some((reason) => /기본 글씨 크기/.test(reason)));
});

test("AI recommendation saves selected language and distinct guidance preferences", () => {
  const selected: RecommendationInput = {
    ageGroup: "60s",
    preferredLanguage: "ja",
    visualIssues: [],
    usageIssues: ["unsureSteps", "needsMoreTime"],
    scrollGuidance: null,
    freeText: null,
  };
  const recommendation = parseRecommendationOutput({
    ...modelResult,
    preferences: {
      ...result.preferences,
      language: "ko",
      stepByStepGuidance: false,
      slowGuidance: false,
      guideDelaySeconds: 20,
    },
    reasons: [
      { text: "해야 할 일을 차례대로 알려드려요.", basedOn: ["unsureSteps"] },
      { text: "안내를 천천히 받을 수 있어요.", basedOn: ["needsMoreTime"] },
    ],
  }, selected);
  assert.equal(recommendation.preferences.language, "ja");
  assert.equal(recommendation.preferences.stepByStepGuidance, true);
  assert.equal(recommendation.preferences.slowGuidance, true);
  assert.equal(recommendation.preferences.guideDelaySeconds, 20);
});

test("scroll guidance recommendation follows yes/no and defaults off when unanswered", () => {
  const yesInput = { ...input, scrollGuidance: true };
  const yesOutput = {
    ...modelResult,
    preferences: { ...result.preferences, scrollGuidance: false },
    reasons: [
      { text: "아래쪽 내용 안내를 켰어요.", basedOn: ["scrollGuidance"] },
      modelResult.reasons[1],
    ],
  };
  const yes = parseRecommendationOutput(yesOutput, yesInput);
  const no = parseRecommendationOutput({
    ...modelResult,
    preferences: { ...result.preferences, scrollGuidance: true },
  }, { ...input, scrollGuidance: false });
  const unanswered = parseRecommendationOutput({
    ...modelResult,
    preferences: { ...result.preferences, scrollGuidance: true },
  }, { ...input, scrollGuidance: null });
  assert.equal(yes.preferences.scrollGuidance, true);
  assert.equal(no.preferences.scrollGuidance, false);
  assert.equal(unanswered.preferences.scrollGuidance, false);
});

test("OpenAI request disables response storage and validates structured response", async () => {
  let captured: Record<string, unknown> | undefined;
  const client = {
    responses: {
      create: async (params: Record<string, unknown>) => {
        captured = params;
        return { output_text: JSON.stringify(modelResult) };
      },
    },
  } as unknown as OpenAI;
  const recommendation = await recommendAccessibility(input, client);
  assert.deepEqual(recommendation, result);
  assert.equal(captured?.store, false);
  assert.equal(captured?.model, "gpt-4o-mini");
});

test("recommendation API returns validated results and rejects sensitive input", async () => {
  let called = 0;
  const app = createApp({} as Pool, async () => {
    called += 1;
    return result;
  });
  const valid = await request(app).post("/api/recommendations").send(input);
  assert.equal(valid.status, 200);
  assert.equal(valid.headers["cache-control"], "no-store");
  assert.deepEqual(valid.body, result);
  const blocked = await request(app)
    .post("/api/recommendations")
    .send({ ...input, freeText: "계좌번호 123456789012" });
  assert.equal(blocked.status, 400);
  assert.equal(blocked.headers["cache-control"], "no-store");
  assert.equal(called, 1);
});

test("API reports missing OpenAI configuration without attempting a provider call", async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const app = createApp({} as Pool);
    const response = await request(app).post("/api/recommendations").send(input);
    assert.equal(response.status, 503);
    assert.equal(response.headers["cache-control"], "no-store");
    assert.match(response.body.error, /직접 설정/);
  } finally {
    if (previousKey !== undefined) process.env.OPENAI_API_KEY = previousKey;
  }
});
