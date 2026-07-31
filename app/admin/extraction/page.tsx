import { notFound } from "next/navigation";
import { RUBRICS } from "@/framework";
import { canTuneExtraction } from "@/lib/authz";
import { getExtractionConfigs, getLatestDropCounts } from "@/lib/data";
import { acceptsTemperature } from "@/lib/extraction/providers/anthropic";
import { resolveProvider } from "@/lib/extraction/provider";
import {
  GUIDANCE_MAX,
  PERSONA_MAX,
  TEMPERATURE_MAX,
} from "@/lib/services/extractionConfig";
import { currentActor } from "@/lib/session";
import { RubricExtractionForm } from "@/components/RubricExtractionForm";

/**
 * Extraction — how the machine reads each macro-dimension (R17, R21).
 *
 * The second ADMIN-only route, and it guards itself for the reason the people
 * page states: middleware authorizes on session presence alone, so it will let
 * a PM through to any path under /admin. `notFound` rather than a refusal page,
 * for the same reason there — absent tells a PM less than forbidden does.
 *
 * This gate is not the boundary. `saveRubricExtractionConfigAction` requires
 * ADMIN again and the service asserts a third time, because rendering no page
 * does not stop anyone calling the action.
 */
export default async function ExtractionTuningPage() {
  const actor = await currentActor();
  if (!actor || !canTuneExtraction(actor.role)) notFound();

  const [configs, dropCounts] = await Promise.all([getExtractionConfigs(), getLatestDropCounts()]);

  /**
   * Whether a temperature reaches the wire at all on this deployment (KTD12).
   *
   * Gemini accepts one; Anthropic removed the parameter from its 5-series, where
   * a non-default value is refused outright rather than degraded. The rule lives
   * in the adapter that knows it — the page asks and passes the answer down as a
   * boolean, so the control can say why it is inert instead of a save failing.
   */
  const provider = resolveProvider();
  const temperatureApplies =
    provider.provider === "gemini" ||
    (provider.provider === "anthropic" && acceptsTemperature(provider.model ?? ""));
  const providerLabel = provider.provider
    ? `${provider.provider} · ${provider.model}`
    : "no provider configured";

  const dropByRubric = new Map(dropCounts.map((d) => [d.rubricKey, d]));
  const labelByRubric = new Map(RUBRICS.map((r) => [r.key, r.label]));

  return (
    <main className="main">
      <div className="page">
        <div className="page-head">
          <span className="eyebrow">Admin · Extraction</span>
          <h1 className="page-title">Extraction tuning</h1>
          <p className="page-lede">
            A persona, a guidance note, and a temperature for each of the six macro-dimensions.
            These shape how the machine reads a transcript — never what it may write. The rows it
            files against, the shape of what it returns, and the rule that it drafts while a person
            scores are generated from the framework and are not editable here.
          </p>
        </div>

        <div className="callout neutral">
          <span className="co-badge">Applies to the next run</span>
          A save takes effect on the next extraction, on every deal. Runs already finished keep the
          text they read under — each observation records its version, so a filing stays traceable
          to the words that produced it.
        </div>

        {configs.map((config) => {
          const lastRun = dropByRubric.get(config.rubricKey) ?? null;
          return (
            <div className="card" key={config.rubricKey}>
              <div className="card-head">
                <h2>{labelByRubric.get(config.rubricKey) ?? config.rubricKey}</h2>
                <span className="count">
                  {config.version === null ? "defaults" : `version ${config.version}`}
                </span>
              </div>
              <RubricExtractionForm
                rubricKey={config.rubricKey}
                label={labelByRubric.get(config.rubricKey) ?? config.rubricKey}
                persona={config.persona}
                guidance={config.guidance}
                temperature={config.temperature}
                version={config.version}
                personaMax={PERSONA_MAX}
                guidanceMax={GUIDANCE_MAX}
                temperatureMax={TEMPERATURE_MAX}
                temperatureApplies={temperatureApplies}
                providerLabel={providerLabel}
                lastRun={
                  lastRun
                    ? {
                        droppedQuotes: lastRun.droppedQuotes,
                        configVersion: lastRun.configVersion,
                      }
                    : null
                }
              />
            </div>
          );
        })}
      </div>
    </main>
  );
}
