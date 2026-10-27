import OpenAI from "openai";
import type { UniversalLayoutPlanProvider } from "./universal-layout-generator";

export type UniversalLayoutOpenAIClient = Pick<OpenAI, "responses">;

/**
 * Shared Universal v1 provider. Only the generator's abstract, policy-validated
 * payload is sent; host content, DOM, item counts and item-order digests are absent.
 */
export function createUniversalLayoutOpenAIProvider(options: {
  apiKey?: string;
  model?: string;
  client?: UniversalLayoutOpenAIClient;
} = {}): UniversalLayoutPlanProvider {
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY?.trim();
  if (!options.client && !apiKey) throw new Error("AI_NOT_CONFIGURED");

  const client = options.client ?? new OpenAI({
    apiKey,
    timeout: 18_000,
    maxRetries: 0,
  });
  const model = options.model?.trim() || process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";

  return {
    async generate({ systemInstruction, payload, responseSchema, signal }) {
      const response = await client.responses.create({
        model,
        store: false,
        max_output_tokens: 500,
        input: [
          { role: "system", content: systemInstruction },
          { role: "user", content: JSON.stringify(payload) },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "universal_layout_plan_v1",
            strict: true,
            schema: responseSchema,
          },
        },
      }, signal ? { signal } : undefined);

      if (!response.output_text) throw new Error("EMPTY_UNIVERSAL_LAYOUT_RESPONSE");
      return response.output_text;
    },
  };
}
