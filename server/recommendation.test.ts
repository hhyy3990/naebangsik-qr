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
    viewportMode: { mode: "bottom", heightPercent: 70 },
  },
  reasons: ["작은 글씨와 위쪽 버튼이 불편하다고 하셔서 글씨를 키우고 조작 영역을 아래로 옮겼어요."],
};
const modelResult = {
  preferences: result.preferences,
  reasons: [{
    text: result.reasons[0],
    basedOn: ["smallText", "topOutOfReach"],
  }],
};

test("recommendation rejects sensitive free text before any model call", () => {
  assert.throws(() => validateRecommendation({ ...input, freeText: "카드번호 4111 1111 1111 1111" }), /SENSITIVE_INPUT/);
  assert.throws(() => validateRecommendation({ ...input, freeText: "010-1234-5678로 연락 주세요" }), /SENSITIVE_INPUT/);
  assert.throws(() => validateRecommendation({ ...input, freeText: "주민등록번호를 입력할게요" }), /SENSITIVE_INPUT/);
});

test("recommendation output is strict, current-v3 only, and rejects unsupported claims", () => {
  assert.deepEqual(parseRecommendationOutput(modelResult, input), result);
  assert.throws(() => parseRecommendationOutput({
    ...modelResult,
    preferences: { ...result.preferences, simplifiedLayout: false },
  }, input));
  assert.throws(() => parseRecommendationOutput({
    ...modelResult,
    reasons: [{ text: "안내를 15초 동안 유지하도록 설정했어요.", basedOn: ["smallText"] }],
  }, input), /UNSUPPORTED_CLAIM/);
  const needsMoreTimeInput: RecommendationInput = { ...input, usageIssues: ["needsMoreTime"] };
  assert.throws(() => parseRecommendationOutput({
    ...modelResult,
    preferences: { ...result.preferences, guideDelaySeconds: 20 },
    reasons: [{ text: "더 편하게 기다릴 수 있도록 바꿨어요.", basedOn: ["needsMoreTime"] }],
  }, needsMoreTimeInput), /UNSUPPORTED_DURATION_MAPPING/);
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
