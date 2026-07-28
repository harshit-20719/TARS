"use client";

import { useState, type ReactNode } from "react";

/**
 * One collapsible macro-dimension in the capture grid.
 *
 * Forty-one rows in one scroll is punishing, and it hides the thing a PM most
 * wants to know — how far through they are, and whether anything in this block is
 * on the floor. So the header carries both, and the rows stay closed until asked
 * for.
 *
 * Everything the header needs is passed in as text and rendered by the server
 * page; only the open/closed state lives here. That keeps the forty-one rows of
 * score controls inside a server-rendered subtree instead of turning the whole
 * grid into client-side work.
 *
 * `open` is component state rather than a URL parameter deliberately: it survives
 * the revalidation that follows every save (which is what matters — a block that
 * snapped shut on each press would be worse than no collapsing at all) and it does
 * not put UI state into a shareable link, where it would be noise.
 */
export function MacroBlock({
  title,
  scored,
  total,
  floorNote,
  floorBad,
  defaultOpen = false,
  children,
}: {
  title: string;
  scored: number;
  total: number;
  /** e.g. "2 floor rows" — omitted when the block has none. */
  floorNote?: string;
  /** True when one of this block's floor rows is actually tripped. */
  floorBad?: boolean;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const complete = scored === total;

  return (
    <div className={`card mb ${open ? "open" : ""}`}>
      <button
        type="button"
        className="mb-head"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className={`mb-caret ${open ? "open" : ""}`} aria-hidden>
          ▸
        </span>
        <h2>{title}</h2>
        <div className="spacer" />
        {floorNote && (
          <span className={`chip xs ${floorBad ? "bad" : "line"}`}>
            {floorBad && <span className="dot" />}
            {floorNote}
          </span>
        )}
        <span className={`count ${complete ? "done" : ""}`}>
          {scored}/{total} scored
        </span>
      </button>
      {open && <div className="card-body flush">{children}</div>}
    </div>
  );
}
