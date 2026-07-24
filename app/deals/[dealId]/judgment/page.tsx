import { notFound } from "next/navigation";
import { getRecord } from "@/mock/data";
import { PILLARS, TRACKS, L1_CAP } from "@/framework";
import { scoreMap } from "@/lib/judgment";
import { SlideCard } from "@/components/SlideCard";
import { FounderRadar } from "@/components/FounderRadar";
import { Icon } from "@/components/icons";

export default async function JudgmentPage({ params }: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await params;
  const rec = getRecord(dealId);
  if (!rec) notFound();

  const scores = scoreMap(rec);
  const slideBy = new Map(rec.slides.map((s) => [s.slideKey, s]));
  const ft = rec.founderTypeRead;
  const hasFt = ft.primary !== "";
  const isDraft = ft.pmConfirmation.startsWith("Draft");

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
        {hasFt && (
        <div className="card" style={{ marginTop: 0 }}>
          <div className="card-head">
            <h2>Founder-type read</h2>
            <div className="spacer" />
            <span className="authorship pm">
              <Icon name="dot" className="i sm" /> {isDraft ? "PM-draft" : "PM-confirmed"}
            </span>
          </div>
          <div className="ft-read">
            <div className="ft-cell">
              <div className="k">Type (machine-drafted, PM-confirmed)</div>
              <div className="ft-type">{ft.primary}</div>
              {ft.secondary && <div className="ft-secondary">secondary · {ft.secondary}</div>}
            </div>
            <div className="ft-cell">
              <div className="k">Founder-track floor dimension</div>
              <div className="ft-type" style={{ fontSize: 14, color: "var(--accent-ink)" }}>
                {ft.floorDimension}
              </div>
              <div className="ft-secondary">{ft.profile}</div>
            </div>
          </div>
          <div className="card-note">
            {ft.pmConfirmation} · No go / conditional-go / no-go verdict at L1 (spec D3).
          </div>
        </div>
        )}
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
        <SlideCard key={p.key} def={p} slide={slideBy.get(p.key)} scores={scores} kindLabel={p.kind} />
      ))}

      <div className="sc-block-title">Tracks · 3</div>
      {TRACKS.map((t) => (
        <SlideCard key={t.key} def={t} slide={slideBy.get(t.key)} scores={scores} kindLabel="track" />
      ))}
    </div>
  );
}
