import Link from "next/link";
import { RUBRICS, rubricByKey } from "@/framework";
import type { CallMeta, ExtractionBlockRun, Observation } from "@/mock/types";

/**
 * What the last extraction actually did, call by call and block by block —
 * rendered from the persisted run record and nothing else (R14, KTD16, R24).
 *
 * This replaced ReviewBoard, the exception queue. Nothing queues any more:
 * every observation files itself as evidence on its capture row, and the verbs
 * (confirm, move, reject) live there with the quotes they act on. What was left
 * for this page was the question the queue used to obscure — how well did the
 * machine read the transcript? — and the run record is the honest answer:
 * which blocks were read, which failed and why, what was dropped before filing,
 * and how sure the filings were.
 *
 * Deliberately read-only. A verb here would rebuild the queue under a new name,
 * and the counts below are temperature feedback for tuning (R20), not work
 * items. The one thing it points at is where the work actually is.
 */
export function ExtractionQualityBoard({
  dealId,
  calls,
  observations,
}: {
  dealId: string;
  calls: CallMeta[];
  observations: Observation[];
}) {
  const transcriptHref = `/deals/${dealId}/transcript`;

  /**
   * No run records anywhere ⇒ extraction has never run on this deal. Distinct
   * from every-block-read-and-clean: a clean run is a fact about a run, and
   * this state is the absence of one.
   */
  if (!calls.some((c) => c.blockRuns.length > 0)) {
    return (
      <div className="card">
        <div className="empty">
          Extraction has not run on this deal yet, so there is no run to read. Add a call on the{" "}
          <Link href={transcriptHref}>transcript step</Link> and run extraction there — each run records,
          block by block, what it could read and what it could not.
        </div>
      </div>
    );
  }

  /**
   * The confidence mix, from the filings themselves. Rejected rows are out —
   * the PM already refused them — and legacy pre-confidence rows carry no
   * confidence, so the three cells need not sum to the first.
   */
  const filed = observations.filter((o) => o.status !== "rejected");
  const confident = filed.filter((o) => o.confidence === "high").length;
  const unconfirmed = filed.filter((o) => o.confidence === "low" && !o.decidedById).length;
  const confirmed = filed.filter((o) => o.confidence === "low" && o.decidedById).length;

  /**
   * Clean means: every call's blocks all read, and no run threw anything away.
   * Merged spans do not break cleanliness — a merge is dedupe housekeeping,
   * not information loss — but they still render on their block's row.
   */
  const allRuns = calls.flatMap((c) => c.blockRuns);
  const allRead = calls.every(
    (c) => c.blockRuns.filter((r) => r.outcome === "read").length === RUBRICS.length,
  );
  const clean = allRead && allRuns.every((r) => r.droppedQuotes === 0 && r.droppedClaims === 0);

  return (
    <div>
      {clean && (
        <div className="callout neutral">
          <span className="co-badge">clean runs</span>
          <span>
            {/*
              Careful with the claim (the old empty state overclaimed here): a
              clean run says the machine read everything and dropped nothing.
              It does not say every filing was confident — the mix below does.
            */}
            <b>Every block read, nothing dropped.</b> The last run over each call read all{" "}
            {RUBRICS.length} blocks, and every quote and claim it returned survived verification. How
            sure each filing was is a separate reading — the mix below carries it.
          </span>
        </div>
      )}

      <div className="summary" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))" }}>
        <div className="cell">
          <span className="k">Filed as evidence</span>
          <span className="v">{filed.length}</span>
        </div>
        <div className="cell">
          <span className="k">High confidence</span>
          <span className="v" style={{ color: "var(--good)" }}>
            {confident}
          </span>
        </div>
        <div className="cell">
          <span className="k">Unsure · unconfirmed</span>
          <span className="v" style={{ color: unconfirmed ? "var(--warn)" : "var(--good)" }}>
            {unconfirmed}
          </span>
          <span className="sub">ruled on from the capture rows</span>
        </div>
        <div className="cell">
          <span className="k">Unsure · confirmed</span>
          <span className="v">{confirmed}</span>
        </div>
      </div>

      {calls.map((c) => {
        const byKey = new Map(c.blockRuns.map((r) => [r.rubricKey, r]));
        const readCount = c.blockRuns.filter((r) => r.outcome === "read").length;
        const unread = RUBRICS.length - readCount;
        return (
          <div className="card" key={c.id}>
            <div className="card-head">
              <h2>
                Call #{c.number} — {c.label}
              </h2>
              {c.blockRuns.length === 0 ? (
                <span className="chip pending">
                  <span className="dot" />
                  not extracted yet
                </span>
              ) : unread > 0 ? (
                <span className="chip warn">
                  <span className="dot" />
                  {unread} of {RUBRICS.length} blocks unread
                </span>
              ) : (
                <span className="chip good">
                  <span className="dot" />
                  all {RUBRICS.length} blocks read
                </span>
              )}
              <div className="spacer" />
              <span className="chip line mono">{c.date}</span>
            </div>
            <div className="card-body">
              {c.blockRuns.length === 0 ? (
                <div className="empty">
                  No run has read this call. Run extraction from the{" "}
                  <Link href={transcriptHref}>transcript step</Link>.
                </div>
              ) : (
                <div className="tbl-wrap">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th style={{ width: "26%" }}>Block</th>
                        <th style={{ width: "44%" }}>Last run</th>
                        <th style={{ width: "20%" }}>Dropped / merged</th>
                        <th style={{ width: "10%" }}>Ran</th>
                      </tr>
                    </thead>
                    <tbody>
                      {RUBRICS.map((r) => (
                        <BlockRow key={r.key} rubricKey={r.key} run={byKey.get(r.key)} />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * One block of one call, as its last run recorded it.
 *
 * The failure split mirrors RunExtractionButton's (R23): a retryable failure —
 * a rate limit, a timeout — is genuinely fixed by pressing run again, so the
 * row says so. A terminal one fails identically on every press, so the row
 * states the fact and never invites a re-run; the lever it names is the model,
 * because that is the only one there is.
 */
function BlockRow({ rubricKey, run }: { rubricKey: string; run?: ExtractionBlockRun }) {
  const label = rubricByKey(rubricKey)?.label ?? rubricKey;

  // No entry for this block: no run has attempted it (a re-run replaces only
  // the blocks it attempts, so an entry, once written, never disappears).
  if (!run) {
    return (
      <tr>
        <td className="mono">{label}</td>
        <td>
          <span className="chip pending">
            <span className="dot" />
            unread
          </span>{" "}
          <span className="ctl-note">no run has attempted this block</span>
        </td>
        <td>—</td>
        <td className="mono">—</td>
      </tr>
    );
  }

  const drops = [
    run.droppedQuotes > 0 && `${run.droppedQuotes} quote${run.droppedQuotes === 1 ? "" : "s"} dropped — not verbatim`,
    run.droppedClaims > 0 && `${run.droppedClaims} claim${run.droppedClaims === 1 ? "" : "s"} dropped — anchor quote gone`,
    run.mergedSpans > 0 && `${run.mergedSpans} span${run.mergedSpans === 1 ? "" : "s"} merged — duplicates`,
  ].filter((d): d is string => Boolean(d));

  return (
    <tr>
      <td className="mono">{label}</td>
      <td>
        {run.outcome === "read" ? (
          <span className="chip good">
            <span className="dot" />
            read
          </span>
        ) : run.outcome === "failed-retryable" ? (
          <>
            <span className="chip warn">
              <span className="dot" />
              failed — a re-run can pick this up
            </span>
            {run.reason && <div className="ctl-note" style={{ marginTop: 4 }}>{run.reason}</div>}
          </>
        ) : (
          <>
            <span className="chip bad">
              <span className="dot" />
              cannot be read from this transcript
            </span>
            {run.reason && <div className="ctl-note" style={{ marginTop: 4 }}>{run.reason}</div>}
            <div className="ctl-note" style={{ marginTop: 4 }}>
              the model refuses this block the same way every time — a different model or provider
              (EXTRACTION_MODEL) is the lever
            </div>
          </>
        )}
      </td>
      <td>
        {drops.length === 0 ? (
          "—"
        ) : (
          <ul className="drop-list" style={{ margin: 0 }}>
            {drops.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        )}
      </td>
      <td className="mono">
        {run.ranAt}
        {/* The duration sits with the timestamp rather than in its own column:
            it is read alongside the outcome, and only when a block is slow or
            failing does anyone look. Absent on rows recorded before it was
            measured, which is not the same as instant — so it renders nothing
            rather than a zero. */}
        {run.durationMs !== undefined && (
          <div className="ctl-note">{(run.durationMs / 1000).toFixed(1)}s</div>
        )}
      </td>
    </tr>
  );
}
