"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "./icons";
import type { StepView } from "@/lib/steps";
import type { Deal } from "@/mock/types";

export function Sidebar({ deal, steps }: { deal: Deal; steps: StepView[] }) {
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

      <div style={{ marginTop: "auto", borderTop: "1px solid var(--line)", paddingTop: "12px" }}>
        <span className="authorship">
          <Icon name="dot" className="i sm" /> machine drafts · <span className="authorship pm">PM scores</span>
        </span>
      </div>
    </aside>
  );
}
