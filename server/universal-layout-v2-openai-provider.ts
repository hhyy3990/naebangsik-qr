import OpenAI from "openai";
import type {
  UniversalLayoutV2PlanProvider,
  UniversalLayoutV2PromptPayload,
} from "./universal-layout-generator-v2";

export type UniversalLayoutV2OpenAIClient = Pick<OpenAI, "responses">;

export function createUniversalLayoutV2OpenAIProvider(options: {
  apiKey?: string;
  model?: string;
  client?: UniversalLayoutV2OpenAIClient;
} = {}): UniversalLayoutV2PlanProvider {
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY?.trim();
  if (!options.client && !apiKey) throw new Error("AI_NOT_CONFIGURED");

  const client = options.client ?? new OpenAI({
    apiKey,
    timeout: 18_000,
    maxRetries: 0,
  });
  const model =
    options.model?.trim() ||
    process.env.UNIVERSAL_LAYOUT_DEV_OPENAI_MODEL?.trim() ||
    "gpt-6-luna";

  return {
    async generate({ systemInstruction, payload, responseSchema, signal }) {
      const response = await client.responses.create({
        model,
        store: false,
        max_output_tokens: 500,
        reasoning: { effort: "none" },
        input: [
          { role: "system", content: systemInstruction },
          { role: "user", content: JSON.stringify(payload as UniversalLayoutV2PromptPayload) },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "universal_layout_plan_v2",
            strict: true,
            schema: responseSchema,
          },
        },
      }, signal ? { signal } : undefined);

      const wasRefused = response.output.some((item) =>
        item.type === "message" && item.content.some((part) => part.type === "refusal"),
      );
      if (wasRefused) throw new Error("UNIVERSAL_LAYOUT_V2_PROVIDER_REFUSED");
      if (!response.output_text) throw new Error("EMPTY_UNIVERSAL_LAYOUT_V2_RESPONSE");
      return response.output_text;
    },
  };
}
