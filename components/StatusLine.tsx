/**
 * The status line — a fixed terminal bar rendering live facts from the record.
 * Always dark in both themes (the one deliberately terminal element), and it
 * ends with the framework's covenant: NO TOTAL · NO VERDICT.
 */

export interface StatusSeg {
  label: string;
  value: string;
  tone?: "good" | "warn" | "bad" | "accent";
}

export function StatusLine({ segments }: { segments: StatusSeg[] }) {
  return (
    <footer className="statusline" aria-label="Record status">
      <span className="sl-brand">TARS 0.1</span>
      {segments.map((s) => (
        <span key={s.label} className={`sl-seg${s.tone ? ` ${s.tone}` : ""}`}>
          <span className="sl-k">{s.label}</span> {s.value}
        </span>
      ))}
      <span className="sl-spacer" />
      <span className="sl-covenant">NO TOTAL · NO VERDICT</span>
    </footer>
  );
}
