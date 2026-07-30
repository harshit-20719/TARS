import type { ReactNode } from "react";

const PATHS: Record<string, ReactNode> = {
  check: <path d="M20 6 9 17l-5-5" />,
  dot: <circle cx="12" cy="12" r="3" />,
  arrow: <path d="M15 18l-6-6 6-6" />,
  play: <path d="M8 5v14l11-7z" fill="currentColor" stroke="none" />,
  flag: <path d="M4 21V4M4 4h11l-2 4 2 4H4" />,
  plus: <path d="M12 5v14M5 12h14" />,
  trash: <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />,
  alert: <path d="M12 9v4M12 17h.01M10.3 3.9 2.6 18a1.5 1.5 0 0 0 1.3 2.2h16.2a1.5 1.5 0 0 0 1.3-2.2L13.7 3.9a1.5 1.5 0 0 0-2.6 0z" />,
  ok: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 12.5l2.5 2.5 4.5-5" />
    </>
  ),
  sun: (
    <>
      <path d="M12 3v2M12 19v2M5 12H3M21 12h-2M6.3 6.3 4.9 4.9M19.1 19.1l-1.4-1.4M17.7 6.3l1.4-1.4M4.9 19.1l1.4-1.4" />
      <circle cx="12" cy="12" r="4" />
    </>
  ),
  /** The floor check — a shield, for the rows that have to hold before anything else. */
  shield: <path d="M12 3l7 3v6c0 4-3 6.5-7 9-4-2.5-7-5-7-9V6l7-3z" />,
  /** The claim ledger — a bound list of things somebody has to go and verify. */
  ledger: (
    <>
      <path d="M5 3h13a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H5z" />
      <path d="M5 8h14M9 3v18" />
    </>
  ),
  /** Coverage — rows against calls, which is exactly what the reading is. */
  grid: (
    <>
      <path d="M4 4h16v16H4z" />
      <path d="M4 9.5h16M4 15h16M10 4v16" />
    </>
  ),
  /** Extraction quality — a trace of what the machine's last run did. */
  pulse: <path d="M3 12h4l2.5-6.5 4.5 13 2.5-6.5H21" />,
};

export function Icon({ name, className = "i" }: { name: string; className?: string }) {
  return (
    // data-icon names which glyph rendered. An unknown name yields an empty svg
    // rather than an error, so without this the only way to tell a missed icon
    // from a present one is to look at the page.
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" data-icon={name}>
      {PATHS[name] ?? null}
    </svg>
  );
}
