"use client";

import { useState } from "react";
import { importFirefliesCallAction, listFirefliesMeetingsAction } from "@/lib/actions";
import { useAction } from "@/lib/useAction";
import { Icon } from "@/components/icons";
import { ControlError } from "../ControlError";
import type { FirefliesMeeting } from "@/lib/fireflies/types";

/**
 * Pick a meeting out of Fireflies and put it on this deal.
 *
 * **Nothing arrives here on its own (R15).** The list is a list; a meeting
 * becomes a call because somebody read the participants, recognised the call,
 * and pressed import. There is no title match against the company name — a
 * founder's name in a meeting title is a coincidence, not a judgment.
 *
 * **What this reaches is stated above the list, not in a tooltip (R16).** There
 * is one Fireflies account for all of Biome, so the list is every call the firm
 * has recorded and the transcript of any of them can be pulled onto any deal.
 * That cannot be narrowed — there is no per-person scope to offer, which is also
 * why there is no scope control here and why the disclosure and the search field
 * sit above the list rather than beside it. Saying so, and recording who
 * imported what (R24), are the only two controls that exist.
 *
 * **The credential never reaches this component (KTD10).** It is read on the
 * server by the page and arrives as one boolean; every meeting and every
 * transcript crosses through a server action. Nothing in this file reads the
 * environment, and the off state names the variable rather than its value.
 *
 * Extraction is not offered here, unlike AddCallForm's save-and-extract. An
 * imported call renders as a card above with its own extraction control the
 * moment this saves, so offering it twice would be two buttons for one job — and
 * this control is already asking the PM to make a judgment about which meeting
 * this is.
 */

/**
 * Fireflies' own page size (MAX_PAGE_SIZE in lib/fireflies/client.ts), repeated
 * rather than imported: that module reads the credential at construction, and
 * importing it from a client component is how a server-only module ends up in
 * the browser bundle.
 */
const PAGE_SIZE = 50;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * The same shape `formatRecordDate` produces for every other date in the record,
 * written out again here because that function lives in lib/domain/codec, which
 * imports Prisma's enums — fine on the server, not something to drag into a
 * browser bundle for one date. UTC rather than the reader's locale, so a meeting
 * is dated the day Fireflies says it happened wherever it is being read.
 */
function meetingDate(iso: string | null): string {
  if (!iso) return "date unknown";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "date unknown";
  return `${String(d.getUTCDate()).padStart(2, "0")} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function ImportFromFireflies({
  dealId,
  nextNumber,
  firefliesEnabled,
}: {
  dealId: string;
  nextNumber: number;
  /** False when the deployment has no FIREFLIES_API_KEY. Never the key itself. */
  firefliesEnabled: boolean;
}) {
  const list = useAction(listFirefliesMeetingsAction);
  const importCall = useAction(importFirefliesCallAction);

  const [open, setOpen] = useState(false);
  /** What is in the search box, which is not yet what the list was fetched with. */
  const [term, setTerm] = useState("");
  /** The term the meetings on screen were actually fetched with. */
  const [searched, setSearched] = useState("");
  /** Null until the first fetch answers — "not asked yet" is not "nothing there". */
  const [meetings, setMeetings] = useState<FirefliesMeeting[] | null>(null);
  const [exhausted, setExhausted] = useState(false);
  const [picked, setPicked] = useState<FirefliesMeeting | null>(null);
  const [number, setNumber] = useState(String(nextNumber));
  const [label, setLabel] = useState("");
  const [note, setNote] = useState<string | null>(null);

  async function load(search: string, skip: number) {
    setNote(null);
    const r = await list.run({ search: search.trim() || undefined, skip });
    if (!r.ok) return;
    setSearched(search.trim());
    // Functional, because a "next page" press resolves against whatever is on
    // screen by then rather than against what was there when it was pressed.
    setMeetings((prev) => (skip === 0 ? r.data : [...(prev ?? []), ...r.data]));
    /**
     * A short page is the end of the list. Fireflies reports no total and offers
     * no cursor, so the alternative is a "next" button that stays lit forever and
     * answers with nothing.
     */
    setExhausted(r.data.length < PAGE_SIZE);
  }

  function choose(m: FirefliesMeeting) {
    setPicked(m);
    setNote(null);
    // Prefilled from the meeting and editable, the way the call number is: the
    // title is a decent label and a poor one about equally often.
    setLabel(m.title.trim() || "");
    /**
     * The number is deliberately left where it is. It starts at `nextNumber` and
     * `runImport` counts it on, and re-deriving it from the prop here would undo
     * that: importing two meetings in one visit would offer the same number
     * twice, because the prop only changes when the page re-renders.
     */
  }

  async function runImport() {
    if (!picked) return;
    const r = await importCall.run({
      dealId,
      meetingId: picked.id,
      number,
      label,
      // The meeting's own date, so the call is dated when it happened rather than
      // when somebody got round to importing it.
      ...(picked.date ? { date: picked.date } : {}),
    });
    if (!r.ok) return;
    setNote(
      `Call ${r.data.number} imported from Fireflies. Run extraction on it from the call above ` +
        `whenever you are ready.`,
    );
    setPicked(null);
    setLabel("");
    setNumber(String(r.data.number + 1));
  }

  /**
   * Off is stated, not hidden. The transcript page already makes this argument
   * for extraction: a control that is simply absent is indistinguishable from a
   * page that failed to render, and the reader has no way to tell which. Naming
   * the variable turns "why can't I import" into a one-line answer.
   */
  if (!firefliesEnabled) {
    return (
      <div className="card">
        <div className="card-head">
          <h2>Import from Fireflies</h2>
        </div>
        <div className="card-body">
          <span className="chip pending">
            <span className="dot" />
            import off · no FIREFLIES_API_KEY on this deployment
          </span>
          <p className="ff-note">
            Pasting a transcript below works exactly as it always has — importing is the second way
            in, not a replacement for the first.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-head">
        <h2>Import from Fireflies</h2>
        <div className="spacer" style={{ flex: 1 }} />
        {!open && (
          <button
            type="button"
            className="btn sm"
            onClick={() => {
              setOpen(true);
              void load("", 0);
            }}
          >
            <Icon name="play" /> Browse meetings
          </button>
        )}
      </div>

      {open && (
        <div className="card-body">
          {/*
            Above the list rather than beside it, because there is no scope
            control for it to sit beside — one shared recording account means one
            list, and the reader has to know that before they read what is in it.
          */}
          <p className="ff-reach">
            <b>Every call Biome has recorded is in this list.</b> There is a single Fireflies
            account for the whole firm, so this is not your meetings — any meeting on it can be
            listed here and its full transcript pulled onto this deal, a board discussion or a
            one-to-one as readily as a founder call. Nothing can narrow that, so the call records
            who imported it.
          </p>

          <div className="ff-search">
            <label htmlFor="ff-q">Search</label>
            <input
              id="ff-q"
              className="inp"
              value={term}
              placeholder="Founder name, email address, or meeting title"
              disabled={list.pending}
              onChange={(e) => setTerm(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void load(term, 0);
              }}
            />
            <button type="button" className="btn sm" disabled={list.pending} onClick={() => void load(term, 0)}>
              Search
            </button>
            {/* Only while a search has something to clear back from. The
                no-matches state carries its own way out, and two identical
                buttons on one panel is a reader working out whether they differ. */}
            {searched !== "" && meetings !== null && meetings.length > 0 && (
              <button
                type="button"
                className="ghostbtn"
                disabled={list.pending}
                onClick={() => {
                  setTerm("");
                  void load("", 0);
                }}
              >
                Clear search
              </button>
            )}
          </div>
          {/* Matched by Fireflies against titles and participants, which is what
              makes a meeting findable at all — the titles follow no convention. */}
          <p className="ff-note">Matches meeting titles and the people who were on the call.</p>

          {list.pending && (
            <div className="ff-state">
              <span className="chip pending">
                <span className="dot" />
                reading Fireflies…
              </span>
            </div>
          )}

          {!list.pending && list.error && (
            <div className="ff-state">
              <ControlError error={list.error} reauth={list.reauth} />
              <button type="button" className="btn sm" onClick={() => void load(searched, 0)}>
                Try again
              </button>
            </div>
          )}

          {!list.pending && !list.error && meetings?.length === 0 && searched === "" && (
            <div className="empty">
              Fireflies has no recordings on this account yet. Paste the transcript below instead.
            </div>
          )}

          {!list.pending && !list.error && meetings?.length === 0 && searched !== "" && (
            <div className="empty">
              No meeting matches “{searched}”.{" "}
              <button
                type="button"
                className="ghostbtn"
                onClick={() => {
                  setTerm("");
                  void load("", 0);
                }}
              >
                Clear search
              </button>
            </div>
          )}

          {!list.error && meetings && meetings.length > 0 && (
            <>
              <ul className="ff-list">
                {meetings.map((m) => (
                  <li key={m.id} className={picked?.id === m.id ? "ff-row picked" : "ff-row"}>
                    <button type="button" className="ff-pick" onClick={() => choose(m)}>
                      {/* The title first because it is what people look for, and
                          the participants and date immediately under it because
                          they are what actually identifies the call (R22). */}
                      <span className="ff-title">{m.title || "Untitled meeting"}</span>
                      <span className="ff-meta">
                        {m.participants.length > 0 ? m.participants.join(", ") : "no participants recorded"}
                      </span>
                      <span className="ff-meta mono">
                        {meetingDate(m.date)}
                        {m.durationMinutes !== null ? ` · ${Math.round(m.durationMinutes)} min` : ""}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <div className="ff-page">
                <span className="ctl-note">
                  Fireflies returns 50 meetings at a time — {meetings.length} loaded
                  {searched !== "" ? ` for “${searched}”` : ""}.
                </span>
                {!exhausted && (
                  <button
                    type="button"
                    className="btn sm"
                    disabled={list.pending}
                    onClick={() => void load(searched, meetings.length)}
                  >
                    Load the next 50
                  </button>
                )}
              </div>
            </>
          )}

          {picked && (
            <div className="ff-picked">
              <div className="ff-picked-head">
                Importing <b>{picked.title || "Untitled meeting"}</b> — {meetingDate(picked.date)}
                {picked.participants.length > 0 ? ` · ${picked.participants.join(", ")}` : ""}
              </div>
              <div className="field-row" style={{ marginBottom: 0 }}>
                <label htmlFor="ff-no" style={{ margin: 0 }}>
                  Call #
                </label>
                <input
                  id="ff-no"
                  className="inp narrow"
                  value={number}
                  inputMode="numeric"
                  disabled={importCall.pending}
                  onChange={(e) => setNumber(e.target.value)}
                />
                <label htmlFor="ff-label" style={{ marginLeft: 8, margin: 0 }}>
                  Label
                </label>
                <input
                  id="ff-label"
                  className="inp"
                  value={label}
                  placeholder="e.g. Second founder call"
                  style={{ flex: 1, minWidth: 200 }}
                  disabled={importCall.pending}
                  onChange={(e) => setLabel(e.target.value)}
                />
              </div>
              <div className="auth-actions">
                <button
                  type="button"
                  className="btn primary"
                  disabled={importCall.pending || label.trim() === "" || number.trim() === ""}
                  onClick={runImport}
                >
                  {importCall.pending ? "Pulling the transcript…" : "Import onto this deal"}
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={importCall.pending}
                  onClick={() => setPicked(null)}
                >
                  Choose a different meeting
                </button>
              </div>
              <ControlError error={importCall.error} reauth={importCall.reauth} />
            </div>
          )}

          {note && !importCall.error && (
            <div className="callout neutral" style={{ marginBottom: 0 }}>
              <span className="co-badge">done</span>
              <span>{note}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
