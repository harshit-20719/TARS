import type { ReactNode } from "react";

const PATHS: Record<string, ReactNode> = {
  check: <path d="M20 6 9 17l-5-5" />,
  dot: <circle cx="12" cy="12" r="3" />,
  arrow: <path d="M15 18l-6-6 6-6" />,
  play: <path d="M8 5v14l11-7z" fill="currentColor" stroke="none" />,
  flag: <path d="M4 21V4M4 4h11l-2 4 2 4H4" />,
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
};

export function Icon({ name, className = "i" }: { name: string; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      {PATHS[name] ?? null}
    </svg>
  );
}
