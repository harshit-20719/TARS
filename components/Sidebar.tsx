"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "./icons";
import type { StepView } from "@/lib/steps";
import type { Deal } from "@/mock/types";

/**
 * A view's icon, by segment.
 *
 * A map rather than the two-way branch this replaced: that one defaulted
 * everything non-floor to the ledger icon, so the third view would have silently
 * borrowed the ledger's rather than getting its own.
 */
const VIEW_ICONS: Record<string, string> = {
  floor: "shield",
  claims: "ledger",
  coverage: "grid",
};

export function Sidebar({
  deal,
  steps,
  views,
}: {
  deal: Deal;
  steps: StepView[];
  /** Cross-cutting readings of the record — the floor and the ledger. */
  views: StepView[];
}) {
  const pathname = usePathname();
  return (
    <aside className="sidebar">
      <Link href="/deals" className="back-link">
        <Icon name="arrow" className="i sm" /> All deals
      </Link>

      <div className="deal-card">
        <div className="company">{deal.company}</div>
        <div className="one-liner">{deal.oneLiner}</div>
        <div className="deal-meta">
          <span className="chip accent mono">{deal.layer} · Conviction</span>
          <span className="chip line">{deal.ownerPm}</span>
        </div>
      </div>

      <div>
        <div className="nav-label">Conviction flow</div>
        <nav className="stepper">
          {steps.map((s, i) => {
            const active = pathname === s.href;
            return (
              <Link key={s.seg || "overview"} href={s.href} className="step" aria-current={active ? "page" : undefined}>
                <span className={`step-dot ${s.done ? "done" : ""}`}>
                  {s.done ? <Icon name="check" className="i sm" /> : i + 1}
                </span>
                <span className="step-name">{s.name}</span>
                <span className="step-state">{s.state}</span>
              </Link>
            );
          })}
        </nav>
      </div>

      <div>
        <div className="nav-label">Views</div>
        <nav className="stepper">
          {views.map((v) => {
            const active = pathname === v.href;
            return (
              <Link key={v.seg} href={v.href} className="step" aria-current={active ? "page" : undefined}>
                <span className={`step-dot flat ${v.done ? "done" : ""} ${v.alert ? "bad" : ""}`}>
                  <Icon name={VIEW_ICONS[v.seg] ?? "ledger"} className="i sm" />
                </span>
                <span className="step-name">{v.name}</span>
                <span className={`step-state ${v.alert ? "bad" : ""}`}>{v.state}</span>
              </Link>
            );
          })}
        </nav>
      </div>

      <div style={{ marginTop: "auto", borderTop: "1px solid var(--line)", paddingTop: "12px" }}>
        <span className="authorship">
          {/* "PM scores" until U1 — a partner authors on the same terms now (R5),
              so the line names the split that is actually enforced. */}
          <Icon name="dot" className="i sm" /> machine drafts · <span className="authorship pm">you score</span>
        </span>
      </div>
    </aside>
  );
}
