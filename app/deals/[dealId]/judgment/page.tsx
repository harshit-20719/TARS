import { notFound } from "next/navigation";
import { getRecord } from "@/lib/data";
import { PILLARS, TRACKS, L1_CAP, subByKey, type Pillar, type Track } from "@/framework";
import { SlideCard } from "@/components/SlideCard";
import { SlideForm } from "@/components/authoring/SlideForm";
import { FounderTypeForm } from "@/components/authoring/FounderTypeForm";
import { FounderRadar } from "@/components/FounderRadar";
import { driverRootKey, scoreMap } from "@/lib/judgment";
import { scoreLabel } from "@/lib/scoring";
import { Icon } from "@/components/icons";

export default async function JudgmentPage({ params }: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await params;
  const rec = await getRecord(dealId);
  if (!rec) notFound();

  const scores = scoreMap(rec);
  const slideBy = new Map(rec.slides.map((s) => [s.slideKey, s]));
  const ft = rec.founderTypeRead;
  const isDraft = ft.pmConfirmation.startsWith("Draft");

  /**
   * A first line for the ceiling guard, naming the rooted row that currently sets
   * the ceiling under this slide's lens. Offered, never filled in: the guard is the
   * anti-vibe rule, and a sentence the app wrote is not the PM's reasoning. It
   * appears as a "use suggested guard" button they have to press.
   */
  function suggestGuard(def: Pillar | Track): string | undefined {
    const driver = driverRootKey(def.lens, def.rooted.map((r) => r.subKey), scores);
    if (!driver) return undefined;
    const sub = subByKey(driver);
    if (!sub) return undefined;
    const lens = def.lens === "peak" ? "Peak" : "Weakest-link";
    return `${lens}: ${sub.label} (${scoreLabel(scores.get(driver))}) sets the ceiling.`;
  }

  return (
    <div className="page">
      <div className="page-head">
        <span className="eyebrow">Step 4 · The human read</span>
        <h1 className="page-title">Judgment slides</h1>
        <p className="page-lede">
          Each pillar and track carries a 0–10 slide you author under its lens. The app shows the rooted sub-scores
          as context — it never computes or averages the slide. At L1 the bankable ceiling is capped at {L1_CAP}; a
          higher read is recorded as a provisional.
        </p>
      </div>

      <div className="grid-2" style={{ marginBottom: 20 }}>
        <div className="card" style={{ marginTop: 0 }}>
          <div className="card-head">
            <h2>Founder read</h2>
            <div className="spacer" />
            <span className="count">F&amp;T sub-scores · 1–5</span>
          </div>
          <div className="card-body" style={{ paddingTop: 14 }}>
            <FounderRadar scores={scores} />
          </div>
          <div className="card-note">The capture behind the Founder/s track — not the 0–10 slide.</div>
        </div>
        <div className="card" style={{ marginTop: 0 }}>
          <div className="card-head">
            <h2>Founder-type read</h2>
            <div className="spacer" />
            <span className="authorship pm">
              <Icon name="dot" className="i sm" />{" "}
              {ft.primary ? (isDraft ? "PM-draft" : "PM-confirmed") : "not read yet"}
            </span>
          </div>
          <FounderTypeForm dealId={dealId} read={ft} />
          <div className="card-note">
            Context only. The type sets the Founder-track floor dimension and the expected-pillar profile — there is
            no go / conditional-go / no-go verdict at L1 (spec D3).
          </div>
        </div>
      </div>

      {rec.slides.length === 0 && (
        <div className="callout neutral">
          <span className="co-badge">not started</span>
          <span>No slides authored yet. Score enough of the capture rubrics, then set each pillar and track here.</span>
        </div>
      )}

      <div className="sc-block-title" style={{ marginTop: rec.slides.length === 0 ? 8 : 0 }}>
        Pillars of differentiation · 7
      </div>
      {PILLARS.map((p) => (
        <div key={p.key}>
          <SlideCard def={p} slide={slideBy.get(p.key)} scores={scores} kindLabel={p.kind} />
          <SlideForm dealId={dealId} def={p} slide={slideBy.get(p.key)} suggestedGuard={suggestGuard(p)} />
        </div>
      ))}

      <div className="sc-block-title">Tracks · 3</div>
      {TRACKS.map((t) => (
        <div key={t.key}>
          <SlideCard def={t} slide={slideBy.get(t.key)} scores={scores} kindLabel="track" />
          <SlideForm dealId={dealId} def={t} slide={slideBy.get(t.key)} suggestedGuard={suggestGuard(t)} />
        </div>
      ))}
    </div>
  );
}
