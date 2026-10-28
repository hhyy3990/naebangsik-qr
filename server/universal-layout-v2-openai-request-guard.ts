import { createHash } from "node:crypto";
import type { UniversalLayoutV2Plan } from "./universal-layout-contract-v2";

const SUCCESS_CACHE_TTL_MS = 30_000;

export class UniversalLayoutV2OpenAIRequestGuard {
  private actualCallStarted = false;
  private readonly inFlight = new Map<string, Promise<UniversalLayoutV2Plan>>();
  private readonly successfulCache = new Map<
    string,
    { expiresAt: number; plan: UniversalLayoutV2Plan }
  >();

  async run(
    fingerprint: string,
    generate: () => Promise<UniversalLayoutV2Plan>,
  ): Promise<{ plan: UniversalLayoutV2Plan; source: "generated" | "in-flight" | "cache" }> {
    const now = Date.now();
    for (const [key, entry] of this.successfulCache) {
      if (entry.expiresAt <= now) this.successfulCache.delete(key);
    }

    const cached = this.successfulCache.get(fingerprint);
    if (cached) return { plan: structuredClone(cached.plan), source: "cache" };

    const pending = this.inFlight.get(fingerprint);
    if (pending) return { plan: await pending, source: "in-flight" };

    if (this.actualCallStarted) {
      const error = new Error("V2_OPENAI_CALL_LIMIT_REACHED");
      error.name = "UniversalLayoutV2OpenAICallLimitError";
      throw error;
    }

    // Consume the single process-level call before invoking provider code.
    this.actualCallStarted = true;
    const result = Promise.resolve().then(generate);
    this.inFlight.set(fingerprint, result);
    try {
      const plan = await result;
      this.successfulCache.set(fingerprint, {
        expiresAt: Date.now() + SUCCESS_CACHE_TTL_MS,
        plan: structuredClone(plan),
      });
      return { plan, source: "generated" };
    } finally {
      this.inFlight.delete(fingerprint);
    }
  }
}

export const universalLayoutV2OpenAIProcessGuard =
  new UniversalLayoutV2OpenAIRequestGuard();

export function universalLayoutV2ModelFingerprint(model: unknown): string {
  return createHash("sha256").update(JSON.stringify(model)).digest("hex");
}
