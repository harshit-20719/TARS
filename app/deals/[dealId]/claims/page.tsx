import { notFound } from "next/navigation";
import { getRecord } from "@/lib/data";
import { subByKey } from "@/framework";
import type { OriginTag } from "@/mock/types";

/**
 * The claim ledger.
 *
 * Every claim the machine drafted, each one anchored to the quote it rests on. It
 * existed before as a side panel on the review page, and badly: the anchor showed
 * as a database id, so the one thing that makes a claim checkable — the words the
 * founder actually said — was the one thing not on screen. Here the quote is the
 * body of the entry.
 *
 * The ledger's job at L1 is to be the hand-off list. Every entry opens at
 * *claimed*: nothing here has been verified, and verification is an L2 activity.
 * So the page is organised by **origin**, because that is what changes how much
 * verification a claim needs:
 *
 *  - founder-volunteered — they raised it unprompted
 *  - founder-confirmed-after-PM-framing — they agreed after we suggested it, which
 *    is weaker evidence of the same fact and easy to misremember as the first kind
 *  - machine-inferred — nobody asserted it; the model read it between the lines,
 *    and it needs confirming before it is treated as a claim at all
 *
 * Keeping those apart is the whole reason the tag exists.
 */

const ORIGIN_ORDER: OriginTag[] = [
  "founder-volunteered",
  "founder-confirmed-after-PM-framing",
  "machine-inferred",
];

const ORIGIN_META: Record<OriginTag, { cls: string; title: string; note: string }> = {
  "founder-volunteered": {
    cls: "good",
    title: "Founder volunteered",
    note: "Raised unprompted. The strongest form of a claim at this layer — still unverified.",
  },
  "founder-confirmed-after-PM-framing": {
    cls: "warn",
    title: "Confirmed after our framing",
    note: "The founder agreed after we put it to them. Weaker than volunteered, and the difference is easy to lose by the time it reaches IC.",
  },
  "machine-inferred": {
    cls: "pending",
    title: "Machine-inferred",
    note: "Nobody asserted this — the model read it from what was said. Confirm it with the founder before treating it as their claim.",
  },
};

export default async function ClaimsPage({ params }: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await params;
  const rec = await getRecord(dealId);
  if (!rec) notFound();

  const obsById = new Map(rec.observations.map((o) => [o.id, o]));
  const groups = ORIGIN_ORDER.map((tag) => ({
    tag,
    meta: ORIGIN_META[tag],
    items: rec.claims.filter((c) => c.originTag === tag),
  }));

  return (
    <div className="page">
      <div className="page-head">
        <span className="eyebrow">The ledger · what L2 has to verify</span>
        <h1 className="page-title">Claim ledger</h1>
        <p className="page-lede">
          Every assertion the founder made about the world, anchored to the words they said it in. All{" "}
          {rec.claims.length} open at status <em>claimed</em> — verification is an L2 activity, so nothing here is
          established yet.
        </p>
      </div>

      <div className="summary" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))" }}>
        <div className="cell">
          <span className="k">Claims</span>
          <span className="v">{rec.claims.length}</span>
        </div>
        {groups.map((g) => (
          <div className="cell" key={g.tag}>
            <span className="k">{g.meta.title}</span>
            <span className="v" style={{ color: `var(--${g.meta.cls})` }}>
              {g.items.length}
            </span>
          </div>
        ))}
      </div>

      {rec.claims.length === 0 ? (
        <div className="card">
          <div className="empty">
            No claims yet. They are drafted alongside observations when extraction runs on a transcript.
          </div>
        </div>
      ) : (
        groups
          .filter((g) => g.items.length > 0)
          .map((g) => (
            <div key={g.tag}>
              <div className="rg-head">
                <span className={`chip ${g.meta.cls} origin`}>{g.tag}</span>
                <span className="rg-rule" />
                <span className="chip line mono">{g.items.length}</span>
              </div>
              <div className="card">
                <div className="card-body">
                  {g.items.map((c) => {
                    const anchor = obsById.get(c.anchorObsId);
                    const sub = anchor ? subByKey(anchor.subDimensionKey) : undefined;
                    return (
                      <div className="claim" key={c.id}>
                        <div className="c-body">
                          <div className="c-text">{c.text}</div>
                          {/*
                            The anchor quote, in full. A claim without the words it
                            came from cannot be checked by anybody later, which is
                            the only thing this ledger is for.
                          */}
                          {anchor ? (
                            <blockquote className="c-anchor">
                              {anchor.quote}
                              <cite>
                                call {anchor.callNumber}
                                {anchor.speaker ? ` · ${anchor.speaker}` : ""}
                                {anchor.timestamp ? ` · ${anchor.timestamp}` : ""}
                                {sub ? ` · filed under ${sub.label}` : ""}
                              </cite>
                            </blockquote>
                          ) : (
                            <div className="ctl-note">
                              the observation this was anchored to has been removed
                            </div>
                          )}
                          <div className="c-meta">
                            <span className="chip line">claimed</span>
                            {anchor?.status === "rejected" && (
                              <span className="chip warn">
                                <span className="dot" />
                                its evidence was rejected
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="card-note">{g.meta.note}</div>
              </div>
            </div>
          ))
      )}
    </div>
  );
}
