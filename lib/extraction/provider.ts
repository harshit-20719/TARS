/**
 * Which provider extraction runs on — decided in exactly one place (R1, R4).
 *
 * The rule is deliberately not a switch variable: presence of a credential is
 * the switch. Gemini is the default — when its key is configured, extraction
 * runs on Gemini, *including when the Anthropic key is also present*. That
 * makes the cutover an operation on credentials alone: deploying the Gemini
 * key moves extraction over, deleting it falls back to Anthropic, and no code
 * or config change rides along with either. With only ANTHROPIC_API_KEY set,
 * extraction runs on Anthropic exactly as before Gemini existed.
 *
 * Everything that mentions extraction reads this module: the orchestrator
 * takes its default provider from `resolveExtractionProvider`, the health
 * route reports `resolveProvider`'s answer, and the transcript page's on/off
 * state is `enabled` here. A surface deciding for itself which key to check is
 * the drift this file exists to prevent.
 *
 * Server-only in the same way the adapters are: credentials are read here and
 * only a yes/no ever leaves the server. Never a NEXT_PUBLIC_ prefix.
 */

import "server-only";

import type { ExtractionProvider } from "./types";
import { ExtractionError } from "./types";
import {
  createAnthropicProvider,
  DEFAULT_EXTRACTION_MODEL,
  type ExtractionClient,
} from "./providers/anthropic";
import { createGeminiProvider, DEFAULT_GEMINI_MODEL } from "./providers/gemini";

export type ExtractionProviderName = "gemini" | "anthropic";

export interface ResolvedProvider {
  /** The active provider, or null when no credential is configured. */
  provider: ExtractionProviderName | null;
  /** The model the active provider will use — EXTRACTION_MODEL, or its default. */
  model: string | null;
  /** Extraction runs when ANY provider is configured. */
  enabled: boolean;
  /** Which credential names would switch extraction on; empty when it already is. */
  missing: string[];
}

/** Trimmed presence, matching how the health route reads every credential. */
const present = (v: string | undefined) => Boolean(v && v.trim());

/**
 * Read the environment into an answer. Called per request, never memoised at
 * module scope, for the reason the adapters give: a credential must never be
 * read at import time, and a long-lived server must see a rotated key.
 */
export function resolveProvider(): ResolvedProvider {
  // The SDK's own precedence for the Gemini credential: GOOGLE_API_KEY first,
  // then GEMINI_API_KEY — mirrored by resolveClient in providers/gemini.ts.
  const gemini = present(process.env.GOOGLE_API_KEY) || present(process.env.GEMINI_API_KEY);
  const anthropic = present(process.env.ANTHROPIC_API_KEY);

  const provider: ExtractionProviderName | null = gemini ? "gemini" : anthropic ? "anthropic" : null;
  if (!provider) {
    return {
      provider: null,
      model: null,
      enabled: false,
      missing: ["GOOGLE_API_KEY", "GEMINI_API_KEY", "ANTHROPIC_API_KEY"],
    };
  }

  // EXTRACTION_MODEL overrides whichever provider is active; empty falls
  // through to that provider's pinned default.
  const override = process.env.EXTRACTION_MODEL?.trim();
  const model = override || (provider === "gemini" ? DEFAULT_GEMINI_MODEL : DEFAULT_EXTRACTION_MODEL);

  return { provider, model, enabled: true, missing: [] };
}

/**
 * The UI sentence for the off state. Only ever shown when *no* provider is
 * configured — one key present enables extraction — so it always names both
 * paths to switching it on. Exported so the copy and the rule live together.
 */
export function missingCredentialCopy(): string {
  return "set GOOGLE_API_KEY (Gemini) or ANTHROPIC_API_KEY (Anthropic)";
}

/**
 * The constructed provider for the orchestrator, per run.
 *
 * `client` keeps extract.ts's injection seam: a test stub is Anthropic-shaped
 * (the original ExtractionClient), so when one is injected the Anthropic
 * adapter carries it regardless of what the environment says — the suite runs
 * with no credentials at all and must not be routed by a developer's shell.
 */
export function resolveExtractionProvider(
  deps: { client?: ExtractionClient; model?: string } = {},
): ExtractionProvider {
  if (deps.client) {
    return createAnthropicProvider({ client: deps.client, model: deps.model });
  }

  const resolved = resolveProvider();
  if (!resolved.provider) {
    throw new ExtractionError(
      "no extraction provider is configured — " + missingCredentialCopy() + ". " +
        "See docs/runbooks/deploy-vercel.md.",
      "terminal",
    );
  }
  return resolved.provider === "gemini"
    ? createGeminiProvider({ model: deps.model })
    : createAnthropicProvider({ model: deps.model });
}
