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
 * The page sizes on offer. 50 is Fireflies' own ceiling (MAX_PAGE_SIZE in
 * lib/fireflies/client.ts), repeated rather than imported: that module reads the
 * credential at construction, and importing it from a client component is how a
 * server-only module ends up in the browser bundle.
 *
 * A smaller page is not a cheaper request — Fireflies is asked once either way —
 * it is a shorter panel, which is the whole point of offering it.
 */
const PAGE_SIZES = [10, 25, 50] as const;

/**
 * Everything that decides what comes back, carried as one object.
 *
 * One value rather than six pieces of state because they are always applied as a
 * set: every fetch sends all of them, and "what is on screen" is only meaningful
 * as the whole combination. Keeping them apart invited the bug where a cleared
 * search still carried the old dates.
 */
interface Filter {
  search: string;
  /** UI-only. Resolves to the two bounds below; `custom` is when they are typed. */
  preset: Preset;
  /** `YYYY-MM-DD`, which is what a date input produces and what the action takes. */
  fromDate: string;
  toDate: string;
  searchField: SearchField;
  sort: SortOrder;
  limit: number;
}

type Preset = "any" | "7d" | "30d" | "3m" | "year" | "custom";
type SearchField = "both" | "title" | "participants";
type SortOrder = "newest" | "oldest";

const PRESETS: { value: Preset; label: string }[] = [
  { value: "any", label: "Any time" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "3m", label: "Last 3 months" },
  { value: "year", label: "This year" },
  { value: "custom", label: "Custom range…" },
];

const SEARCH_FIELDS: { value: SearchField; label: string }[] = [
  { value: "both", label: "Title and participants" },
  { value: "title", label: "Title only" },
  { value: "participants", label: "Participants only" },
];

const NO_FILTER: Filter = {
  search: "",
  preset: "any",
  fromDate: "",
  toDate: "",
  searchField: "both",
  sort: "newest",
  limit: 50,
};

const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Turn the chosen preset into the two bounds the action actually takes.
 *
 * Computed at fetch time rather than when the preset is picked, so "last 7 days"
 * still means seven days from now if the panel has been open a while. UTC
 * throughout, matching how every other date in the record is handled.
 */
function rangeFor(f: Filter): { fromDate: string; toDate: string } {
  if (f.preset === "custom") return { fromDate: f.fromDate, toDate: f.toDate };
  if (f.preset === "any") return { fromDate: "", toDate: "" };

  const now = new Date();
  if (f.preset === "year") return { fromDate: `${now.getUTCFullYear()}-01-01`, toDate: "" };

  const from = new Date(now);
  if (f.preset === "7d") from.setUTCDate(now.getUTCDate() - 7);
  else if (f.preset === "30d") from.setUTCDate(now.getUTCDate() - 30);
  else from.setUTCMonth(now.getUTCMonth() - 3);
  // No upper bound: "the last 30 days" ends now, and sending today's date as a
  // ceiling would exclude a call recorded an hour ago in a later timezone.
  return { fromDate: iso(from), toDate: "" };
}

const isFiltered = (f: Filter) =>
  f.search !== "" || f.preset !== "any" || f.searchField !== "both";

/** How the applied filter reads back to the PM, for the empty and count states. */
function describeFilter(f: Filter): string {
  const parts: string[] = [];
  if (f.search) {
    const where =
      f.searchField === "title" ? " in titles"
      : f.searchField === "participants" ? " in participants"
      : "";
    parts.push(`“${f.search}”${where}`);
  }
  const { fromDate, toDate } = rangeFor(f);
  if (f.preset === "custom" && fromDate && toDate) parts.push(`between ${fromDate} and ${toDate}`);
  else if (f.preset === "custom" && fromDate) parts.push(`on or after ${fromDate}`);
  else if (f.preset === "custom" && toDate) parts.push(`on or before ${toDate}`);
  else if (f.preset !== "any") {
    parts.push(`in ${PRESETS.find((p) => p.value === f.preset)!.label.toLowerCase()}`);
  }
  return parts.join(" ");
}

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
  /** What is in the boxes, which is not yet what the list was fetched with. */
  const [draft, setDraft] = useState<Filter>(NO_FILTER);
  /** The filter the meetings on screen were actually fetched with. */
  const [applied, setApplied] = useState<Filter>(NO_FILTER);
  /**
   * What `load` was last called with, set before the request goes out rather
   * than after it lands — which is exactly how it differs from `applied`.
   * "Try again" has to retry the fetch that just failed, and `applied` only
   * ever names the last one that *succeeded*: retrying against it would take a
   * failed search for "aparna" and silently hand back whatever the unfiltered
   * list (or an earlier term) last was, with no sign the failed term was
   * dropped. Keeping skip here too means a failed next-page load retries that
   * page rather than snapping back to the top of the list.
   */
  const [attempted, setAttempted] = useState<{ filter: Filter; skip: number }>({
    filter: NO_FILTER,
    skip: 0,
  });
  /** Null until the first fetch answers — "not asked yet" is not "nothing there". */
  const [meetings, setMeetings] = useState<FirefliesMeeting[] | null>(null);
  /**
   * What the *next* page should ask Fireflies to skip.
   *
   * Tracked rather than derived from `meetings.length`, which is the arithmetic
   * this replaces. `skip` is applied per branch server-side, and a search runs
   * two branches merged and de-duplicated — so the rows on screen are never a
   * count of what either branch consumed. Paging by that count skipped past
   * meetings nobody ever saw.
   */
  const [skip, setSkip] = useState(0);
  /** Fireflies' own answer, not a guess from the page size. See MeetingPage. */
  const [hasMore, setHasMore] = useState(false);
  const [picked, setPicked] = useState<FirefliesMeeting | null>(null);
  const [number, setNumber] = useState(String(nextNumber));
  const [label, setLabel] = useState("");
  const [note, setNote] = useState<string | null>(null);

  async function load(filter: Filter, atSkip: number) {
    setNote(null);
    // Recorded before the request goes out, not after — see the comment on
    // `attempted` above. Setting it here rather than only on the failure path
    // keeps one place responsible for "what was this call for" instead of
    // duplicating that decision at every call site.
    setAttempted({ filter, skip: atSkip });
    const { fromDate, toDate } = rangeFor(filter);
    const r = await list.run({
      search: filter.search.trim() || undefined,
      fromDate: fromDate || undefined,
      toDate: toDate || undefined,
      searchField: filter.searchField,
      sort: filter.sort,
      limit: filter.limit,
      skip: atSkip,
    });
    if (!r.ok) return;
    setApplied({ ...filter, search: filter.search.trim() });
    // Functional, because a "next page" press resolves against whatever is on
    // screen by then rather than against what was there when it was pressed.
    //
    // De-duplicated by id when appending. A search runs as two aliased GraphQL
    // selections — byTitle and byParticipant — merged server-side, and paging
    // advances both branches by the same skip, so a meeting can legitimately
    // arrive again on a later page. Appending it unchecked would render two
    // <li> with the same key={m.id}.
    setMeetings((prev) => {
      if (atSkip === 0) return r.data.meetings;
      const seen = new Set((prev ?? []).map((m) => m.id));
      return [...(prev ?? []), ...r.data.meetings.filter((m) => !seen.has(m.id))];
    });
    /**
     * Advance by the page size, not by how many rows came back.
     *
     * A merged search page can hold anything from nothing to twice the page
     * size, and neither number says how far either branch got — only the skip
     * that was sent does. And whether more exists is Fireflies' answer, carried
     * on the page (see MeetingPage), rather than something inferred here from a
     * short list.
     */
    // `filter.limit`, not `applied.limit`: setApplied above does not land until the
    // next render, so reading state here would step by the *previous* page size
    // on the fetch that changed it.
    setSkip(atSkip + filter.limit);
    setHasMore(r.data.hasMore);
  }

  function choose(m: FirefliesMeeting) {
    setPicked(m);
    setNote(null);
    // A refused import names the meeting that caused it — "already on this
    // deal as call 2" — and that sentence is only true of the meeting that was
    // picked when it fired. Left on screen across a new pick, it would still
    // be showing the moment a different, unrelated meeting is chosen: a PM
    // reading it would take a fresh, valid choice for a duplicate. Cleared the
    // way ReassignDeal's close() clears `move`'s error on the same kind of
    // reset — via the hook's own `clearError`, not by hand-rolling one here.
    importCall.clearError();
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
              // Only on the first open. Re-opening shows what was already
              // fetched rather than spending a request to redraw the same list.
              if (meetings === null) void load(draft, 0);
            }}
          >
            <Icon name="play" /> Browse meetings
          </button>
        )}
        {/*
          Closing is a real need rather than a nicety: with the disclosure, four
          filters, fifty rows and the import form, this panel is the longest
          thing on the page, and the paste form lives underneath it. It hides,
          it does not reset — the list, the filters and a chosen meeting all
          survive, so re-opening costs nothing and loses nothing.
        */}
        {open && (
          <button type="button" className="ghostbtn" onClick={() => setOpen(false)}>
            Close
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

          {/*
            One grid rather than a stack of labelled rows. Four filters plus a
            search box is a lot of panel, and this control already competes for
            height with the list it filters — so they sit on as few lines as the
            width allows and the whole block collapses with the panel.
          */}
          <div className="ff-filters">
            <div className="ff-filter grow">
              <label htmlFor="ff-q">Search</label>
              <input
                id="ff-q"
                className="inp"
                value={draft.search}
                placeholder="Founder name, email address, or meeting title"
                disabled={list.pending}
                onChange={(e) => setDraft({ ...draft, search: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void load(draft, 0);
                }}
              />
            </div>

            <div className="ff-filter">
              <label htmlFor="ff-field">Match</label>
              <select
                id="ff-field"
                className="inp"
                value={draft.searchField}
                disabled={list.pending}
                onChange={(e) =>
                  setDraft({ ...draft, searchField: e.target.value as SearchField })
                }
              >
                {SEARCH_FIELDS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="ff-filter">
              <label htmlFor="ff-when">Recorded</label>
              <select
                id="ff-when"
                className="inp"
                value={draft.preset}
                disabled={list.pending}
                onChange={(e) => setDraft({ ...draft, preset: e.target.value as Preset })}
              >
                {PRESETS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Only the custom option needs the two boxes, so only it shows them. */}
            {draft.preset === "custom" && (
              <>
                <div className="ff-filter">
                  <label htmlFor="ff-from">From</label>
                  <input
                    id="ff-from"
                    className="inp narrow"
                    type="date"
                    value={draft.fromDate}
                    disabled={list.pending}
                    max={draft.toDate || undefined}
                    onChange={(e) => setDraft({ ...draft, fromDate: e.target.value })}
                  />
                </div>
                <div className="ff-filter">
                  <label htmlFor="ff-to">To</label>
                  <input
                    id="ff-to"
                    className="inp narrow"
                    type="date"
                    value={draft.toDate}
                    disabled={list.pending}
                    min={draft.fromDate || undefined}
                    onChange={(e) => setDraft({ ...draft, toDate: e.target.value })}
                  />
                </div>
              </>
            )}

            <div className="ff-filter">
              <label htmlFor="ff-sort">Sort</label>
              <select
                id="ff-sort"
                className="inp"
                value={draft.sort}
                disabled={list.pending}
                onChange={(e) => setDraft({ ...draft, sort: e.target.value as SortOrder })}
              >
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
              </select>
            </div>

            <div className="ff-filter">
              <label htmlFor="ff-size">Show</label>
              <select
                id="ff-size"
                className="inp narrow"
                value={String(draft.limit)}
                disabled={list.pending}
                onChange={(e) => setDraft({ ...draft, limit: Number(e.target.value) })}
              >
                {PAGE_SIZES.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>

            <div className="ff-filter actions">
              <button
                type="button"
                className="btn sm"
                disabled={list.pending}
                onClick={() => void load(draft, 0)}
              >
                Apply
              </button>
              {/* Only while something has been applied to clear back from. The
                  no-matches state carries its own way out, and two identical
                  buttons on one panel is a reader working out whether they differ. */}
              {isFiltered(applied) && meetings !== null && meetings.length > 0 && (
                <button
                  type="button"
                  className="ghostbtn"
                  disabled={list.pending}
                  onClick={() => {
                    setDraft(NO_FILTER);
                    void load(NO_FILTER, 0);
                  }}
                >
                  Clear filters
                </button>
              )}
            </div>
          </div>
          {/*
            Two things a reader would otherwise have to discover. Sorting orders
            the page rather than the archive — Fireflies decides what lands in a
            page — and narrowing the match to one field is what makes paging
            exact, since the merge of two is what blurs it.
          */}
          <p className="ff-note">
            Matching both title and participants is the widest search; narrowing to one makes
            paging exact. Sorting orders the meetings already fetched, not the whole archive.
          </p>

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
              {/* Retries what `load` was last asked for, not `applied` — see the
                  comment on `attempted` above. `applied` only updates on a
                  success, so retrying against it after a failed search would
                  quietly resurrect whatever term (or page) last worked. */}
              <button
                type="button"
                className="btn sm"
                onClick={() => void load(attempted.filter, attempted.skip)}
              >
                Try again
              </button>
            </div>
          )}

          {!list.pending && !list.error && meetings?.length === 0 && !isFiltered(applied) && (
            <div className="empty">
              Fireflies has no recordings on this account yet. Paste the transcript below instead.
            </div>
          )}

          {!list.pending && !list.error && meetings?.length === 0 && isFiltered(applied) && (
            <div className="empty">
              No meeting matches {describeFilter(applied)}.{" "}
              <button
                type="button"
                className="ghostbtn"
                onClick={() => {
                  setDraft(NO_FILTER);
                  void load(NO_FILTER, 0);
                }}
              >
                Clear filters
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
                  {isFiltered(applied) ? ` matching ${describeFilter(applied)}` : ""}.
                </span>
                {hasMore && (
                  <button
                    type="button"
                    className="btn sm"
                    disabled={list.pending}
                    onClick={() => void load(applied, skip)}
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
                  onClick={() => {
                    setPicked(null);
                    // Same reason as choose(): stepping back to the list must
                    // not leave a refusal behind for whatever gets picked next
                    // to inherit.
                    importCall.clearError();
                  }}
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
