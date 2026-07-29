import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { render, screen, within } from "@testing-library/react";
import { act } from "react";

/**
 * The Fireflies picker.
 *
 * What is pinned here is mostly prose, which is unusual for a component test and
 * deliberate. With one shared recording account there is nothing to scope and
 * nothing to restrict: the disclosure above the list and the attribution on the
 * call are the only two controls this feature has, so the sentence that says
 * "any meeting Biome has recorded can be listed and its full transcript pulled
 * onto this deal" is a control and is tested like one.
 *
 * The rest is the five states. Every other control in this app fetches on submit;
 * this one fetches on open, so pending, empty, no-match, failed, and
 * there-is-more are all states the app has no precedent for and no other test
 * would notice losing.
 *
 * Named .test.tsx deliberately: vitest.components.config.ts includes only
 * .test.tsx under components/, so a .test.ts here would run in neither suite and
 * pass by never executing.
 */

type Result<T> = { ok: true; data: T } | { ok: false; error: string; field?: string };

type Meeting = {
  id: string;
  title: string;
  participants: string[];
  date: string | null;
  durationMinutes: number | null;
};

/** What the list action hands back: one page, plus Fireflies' own "there is more". */
type MeetingPage = { meetings: Meeting[]; hasMore: boolean };

const listFirefliesMeetingsAction =
  vi.fn<
    (o?: {
      search?: string;
      fromDate?: string;
      toDate?: string;
      skip?: number;
      limit?: number;
    }) => Promise<Result<MeetingPage>>
  >();
const importFirefliesCallAction =
  vi.fn<(raw: unknown) => Promise<Result<{ callId: string; number: number }>>>();
const addCallAction = vi.fn<(raw: unknown) => Promise<Result<string>>>(async () => ({
  ok: true,
  data: "call-1",
}));
const runExtractionAction = vi.fn();

vi.mock("@/lib/actions", () => ({
  listFirefliesMeetingsAction: (o?: unknown) => listFirefliesMeetingsAction(o as never),
  importFirefliesCallAction: (raw: unknown) => importFirefliesCallAction(raw),
  addCallAction: (raw: unknown) => addCallAction(raw),
  runExtractionAction: (...a: unknown[]) => runExtractionAction(...a),
}));

// ControlError reads the path to build its sign-in-again link.
vi.mock("next/navigation", () => ({ usePathname: () => "/deals/halten/transcript" }));

const { ImportFromFireflies } = await import("./ImportFromFireflies");
const { AddCallForm } = await import("./AddCallForm");

const FOUNDER_CALL: Meeting = {
  id: "ff-halten-2",
  // AE7: named after the founder, while the deal is filed under the company.
  title: "Biome <> Aparna",
  participants: ["aparna@halten.com", "pm@biome.in"],
  date: "2026-07-22T09:30:00.000Z",
  durationMinutes: 42,
};

const BOARD_CALL: Meeting = {
  id: "ff-board-1",
  title: "Biome board — Q3",
  participants: ["partner@biome.in"],
  date: "2026-07-01T14:00:00.000Z",
  durationMinutes: 90,
};

const page = (n: number): Meeting[] =>
  Array.from({ length: n }, (_, i) => ({
    ...FOUNDER_CALL,
    id: `ff-${i}`,
    title: `Meeting ${i}`,
  }));

function mount(props: Partial<Parameters<typeof ImportFromFireflies>[0]> = {}) {
  render(
    <ImportFromFireflies dealId="halten" nextNumber={2} firefliesEnabled={true} {...props} />,
  );
}

const press = (label: string | RegExp) =>
  act(async () => {
    screen.getByRole("button", { name: label }).click();
  });

const choose = (labelText: RegExp, value: string) =>
  act(async () => {
    const select = screen.getByLabelText(labelText) as HTMLSelectElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
    setter.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });

const type = (labelText: RegExp, value: string) =>
  act(async () => {
    const input = screen.getByLabelText(labelText) as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });

/** Open the picker with the given answer already queued. */
async function open(
  meetings: Meeting[] = [FOUNDER_CALL, BOARD_CALL],
  { hasMore = false }: { hasMore?: boolean } = {},
) {
  listFirefliesMeetingsAction.mockResolvedValue({ ok: true, data: { meetings, hasMore } });
  mount();
  await press(/browse meetings/i);
}

beforeEach(() => {
  listFirefliesMeetingsAction.mockReset();
  importFirefliesCallAction.mockReset();
  addCallAction.mockClear();
  listFirefliesMeetingsAction.mockResolvedValue({ ok: true, data: { meetings: [], hasMore: false } });
  importFirefliesCallAction.mockResolvedValue({ ok: true, data: { callId: "c1", number: 2 } });
});

describe("what the picker says about its own reach", () => {
  /**
   * R16. The sentence has to cover retrieval and not only listing: "these are
   * the workspace's meetings" reads as a directory, and what the feature
   * actually does is pull the full text of any of them onto a deal.
   */
  it("states that any meeting can be listed and its full transcript pulled onto the deal", async () => {
    await open();

    const reach = screen.getByText(/every call biome has recorded/i).parentElement!;
    expect(reach.textContent).toMatch(/full transcript/i);
    expect(reach.textContent).toMatch(/pulled onto this deal/i);
  });

  /**
   * R11. The list is the shared account's, and the picker says so rather than
   * letting a PM read it as their own calendar — there is no scope control to
   * infer that from, because there is no scope.
   */
  it("says the list is the whole firm's, and offers no scope control", async () => {
    await open();

    const reach = screen.getByText(/every call biome has recorded/i).parentElement!;
    expect(reach.textContent).toMatch(/single fireflies account for the whole firm/i);
    expect(reach.textContent).toMatch(/not your meetings/i);
    /**
     * There are selects on the panel now — match, date range, sort, page size —
     * so counting them proves nothing. What must stay true is that none of them
     * offers a *whose meetings* choice, because no such filter exists: one
     * shared account means host_email is identical for every meeting (R11).
     */
    const options = screen.getAllByRole("option").map((o) => o.textContent ?? "");
    expect(options.length).toBeGreaterThan(0);
    for (const label of options) {
      expect(label).not.toMatch(/\bmy\b|\bmine\b|everyone|colleague|owner|host/i);
    }
    expect(screen.queryByLabelText(/whose|scope|owner/i)).toBeNull();
  });

  it("names who will be recorded against the import", async () => {
    await open();

    const reach = screen.getByText(/every call biome has recorded/i).parentElement!;
    expect(reach.textContent).toMatch(/records who imported it/i);
  });
});

describe("the five states", () => {
  it("shows a pending state while the list loads", async () => {
    let answer!: (r: Result<MeetingPage>) => void;
    listFirefliesMeetingsAction.mockImplementationOnce(
      () => new Promise<Result<MeetingPage>>((resolve) => (answer = resolve)),
    );
    mount();

    await press(/browse meetings/i);
    expect(screen.getByText(/reading fireflies/i)).toBeTruthy();

    await act(async () => answer({ ok: true, data: { meetings: [FOUNDER_CALL], hasMore: false } }));
    expect(screen.queryByText(/reading fireflies/i)).toBeNull();
  });

  it("says the account has no recordings rather than showing an empty list", async () => {
    await open([]);

    expect(screen.getByText(/fireflies has no recordings on this account yet/i)).toBeTruthy();
  });

  it("names the filter that matched nothing, and offers a way to clear it", async () => {
    await open([FOUNDER_CALL]);
    listFirefliesMeetingsAction.mockResolvedValue({ ok: true, data: { meetings: [], hasMore: false } });

    await type(/search/i, "aparna");
    await press(/apply/i);

    expect(screen.getByText(/no meeting matches “aparna”/i)).toBeTruthy();

    listFirefliesMeetingsAction.mockResolvedValue({ ok: true, data: { meetings: [FOUNDER_CALL], hasMore: false } });
    await press(/clear filters/i);
    expect(screen.getByText("Biome <> Aparna")).toBeTruthy();
  });

  /**
   * The typed Fireflies message, not a generic one. `toResult` in lib/actions.ts
   * exists to make "the FIREFLIES_API_KEY is not valid" reach a screen at all —
   * rendering it as "something went wrong" here would waste that.
   */
  it("renders the failure Fireflies reported, with a retry", async () => {
    listFirefliesMeetingsAction.mockResolvedValue({
      ok: false,
      error: "the FIREFLIES_API_KEY is not valid, so no meetings were read.",
    });
    mount();
    await press(/browse meetings/i);

    expect(screen.getByText(/the FIREFLIES_API_KEY is not valid/)).toBeTruthy();

    listFirefliesMeetingsAction.mockResolvedValue({ ok: true, data: { meetings: [FOUNDER_CALL], hasMore: false } });
    await press(/try again/i);
    expect(screen.getByText("Biome <> Aparna")).toBeTruthy();
  });

  /**
   * `searched` only ever names the search that last *succeeded* — the blank
   * browse, here — so a retry built from it would silently drop the failed
   * term and hand back the unfiltered list instead of retrying what was
   * actually asked for. `attempted` is what "try again" retries instead: set
   * before the request goes out, so it names the failed call, not the last
   * one that worked.
   */
  it('retries the failed search term on "try again", not the last successful one', async () => {
    await open([FOUNDER_CALL]); // the initial browse succeeds with search: undefined

    listFirefliesMeetingsAction.mockResolvedValue({
      ok: false,
      error: "the FIREFLIES_API_KEY is not valid, so no meetings were read.",
    });
    await type(/search/i, "aparna");
    await press(/apply/i);
    expect(screen.getByText(/the FIREFLIES_API_KEY is not valid/)).toBeTruthy();

    listFirefliesMeetingsAction.mockResolvedValue({ ok: true, data: { meetings: [FOUNDER_CALL], hasMore: false } });
    await press(/try again/i);

    // Not { search: undefined, skip: 0 } — that would be the blank browse the
    // list last successfully loaded with, silently dropping "aparna".
    expect(listFirefliesMeetingsAction).toHaveBeenLastCalledWith({
      search: "aparna",
      fromDate: undefined,
      toDate: undefined,
      searchField: "both",
      sort: "newest",
      limit: 50,
      skip: 0,
    });
  });

  /**
   * Fireflies pages at 50 with no total and no cursor, so "there may be more" is
   * a fact about the API the reader has to be told — a bare "next" button would
   * leave them guessing whether the list they are searching is all of it.
   */
  it("states the page size and asks Fireflies for the next 50", async () => {
    await open(page(50), { hasMore: true });

    expect(screen.getByText(/fireflies returns 50 meetings at a time/i)).toBeTruthy();

    listFirefliesMeetingsAction.mockResolvedValue({ ok: true, data: { meetings: [FOUNDER_CALL], hasMore: false } });
    await press(/load the next 50/i);

    expect(listFirefliesMeetingsAction).toHaveBeenLastCalledWith({
      search: undefined,
      fromDate: undefined,
      toDate: undefined,
      searchField: "both",
      sort: "newest",
      limit: 50,
      skip: 50,
    });
    // Appended, not replaced — paging forward must not lose the page above it.
    expect(screen.getAllByRole("listitem")).toHaveLength(51);
    // And a short page is the end of it, so the offer goes away.
    expect(screen.queryByRole("button", { name: /load the next 50/i })).toBeNull();
  });

  /**
   * A search runs as two aliased GraphQL selections merged into one page
   * server-side (mergeBranches, lib/fireflies/client.ts) — but only within
   * that page. A meeting already on screen can legitimately come back again
   * on the page after it, and appending pages unchecked would render two
   * <li> sharing one key={m.id}.
   */
  it("keeps a meeting once when an appended page repeats one already on screen", async () => {
    await open(page(50), { hasMore: true });
    expect(screen.getAllByRole("listitem")).toHaveLength(50);

    const secondPage: Meeting[] = [
      { ...FOUNDER_CALL, id: "ff-0", title: "Meeting 0" }, // already on screen, from page one
      ...Array.from({ length: 49 }, (_, i) => ({
        ...FOUNDER_CALL,
        id: `ff-${50 + i}`,
        title: `Meeting ${50 + i}`,
      })),
    ];
    listFirefliesMeetingsAction.mockResolvedValue({ ok: true, data: { meetings: secondPage, hasMore: false } });
    await press(/load the next 50/i);

    // 50 from the first page plus the 49 genuinely new ones from the second —
    // not 100 — and the repeated meeting renders once, not twice.
    expect(screen.getAllByRole("listitem")).toHaveLength(99);
    expect(screen.getAllByText("Meeting 0")).toHaveLength(1);
  });
});

describe("identifying the right meeting", () => {
  /**
   * R22. The titles follow no convention — this one names the founder and the
   * deal is filed under Halten — so the row has to carry the participants and
   * the date, which is what the PM actually recognises the call by (AE7).
   */
  it("shows participants and a date on every row", async () => {
    await open();

    const row = screen.getByText("Biome <> Aparna").closest("li")!;
    expect(within(row).getByText(/aparna@halten\.com, pm@biome\.in/)).toBeTruthy();
    expect(within(row).getByText(/22 Jul 2026/)).toBeTruthy();
  });

  it("searches by whatever the PM types, without pre-filtering it here", async () => {
    await open();
    listFirefliesMeetingsAction.mockResolvedValue({ ok: true, data: { meetings: [FOUNDER_CALL], hasMore: false } });

    await type(/search/i, "aparna@halten.com");
    await press(/apply/i);

    expect(listFirefliesMeetingsAction).toHaveBeenLastCalledWith({
      search: "aparna@halten.com",
      fromDate: undefined,
      toDate: undefined,
      searchField: "both",
      sort: "newest",
      limit: 50,
      skip: 0,
    });
  });

  it("still identifies a meeting Fireflies gave no title or participants", async () => {
    await open([{ ...FOUNDER_CALL, title: "", participants: [], date: null }]);

    expect(screen.getByText("Untitled meeting")).toBeTruthy();
    expect(screen.getByText(/no participants recorded/i)).toBeTruthy();
    expect(screen.getByText(/date unknown/i)).toBeTruthy();
  });
});

describe("narrowing by when a call was recorded", () => {
  /**
   * The other half of finding a call. One shared account holds every recording
   * the firm has made, and "the week we first met them" is often what a PM
   * actually remembers — so a date range is the filter search cannot express.
   */
  it("sends both bounds to Fireflies, and resets to the first page", async () => {
    await open([FOUNDER_CALL]);

    await choose(/recorded/i, "custom");
    await type(/^from$/i, "2026-07-01");
    await type(/^to$/i, "2026-07-31");
    await press(/apply/i);

    expect(listFirefliesMeetingsAction).toHaveBeenLastCalledWith({
      search: undefined,
      fromDate: "2026-07-01",
      toDate: "2026-07-31",
      searchField: "both",
      sort: "newest",
      limit: 50,
      skip: 0,
    });
  });

  it("combines a date range with a search rather than replacing it", async () => {
    await open([FOUNDER_CALL]);

    await type(/search/i, "aparna");
    await choose(/recorded/i, "custom");
    await type(/^from$/i, "2026-07-01");
    await press(/apply/i);

    expect(listFirefliesMeetingsAction).toHaveBeenLastCalledWith({
      search: "aparna",
      fromDate: "2026-07-01",
      toDate: undefined,
      searchField: "both",
      sort: "newest",
      limit: 50,
      skip: 0,
    });
  });

  it("names the range in the empty state when nothing matched", async () => {
    await open([FOUNDER_CALL]);
    listFirefliesMeetingsAction.mockResolvedValue({ ok: true, data: { meetings: [], hasMore: false } });

    await choose(/recorded/i, "custom");
    await type(/^from$/i, "2026-01-01");
    await type(/^to$/i, "2026-01-31");
    await press(/apply/i);

    expect(screen.getByText(/between 2026-01-01 and 2026-01-31/i)).toBeTruthy();
  });

  /** Clearing has to clear the dates too, not just the term. */
  it("clears the dates along with the search term", async () => {
    await open([FOUNDER_CALL]);

    await type(/search/i, "aparna");
    await choose(/recorded/i, "custom");
    await type(/^from$/i, "2026-07-01");
    await press(/apply/i);
    await press(/clear filters/i);

    expect(listFirefliesMeetingsAction).toHaveBeenLastCalledWith({
      search: undefined,
      fromDate: undefined,
      toDate: undefined,
      searchField: "both",
      sort: "newest",
      limit: 50,
      skip: 0,
    });
  });
});

describe("the filter dropdowns", () => {
  it("narrows the search to one field when asked", async () => {
    await open([FOUNDER_CALL]);

    await type(/search/i, "aparna");
    await choose(/match/i, "participants");
    await press(/apply/i);

    expect(listFirefliesMeetingsAction).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: "aparna", searchField: "participants" }),
    );
  });

  it("asks for oldest first when the sort is flipped", async () => {
    await open([FOUNDER_CALL]);

    await choose(/sort/i, "oldest");
    await press(/apply/i);

    expect(listFirefliesMeetingsAction).toHaveBeenLastCalledWith(
      expect.objectContaining({ sort: "oldest" }),
    );
  });

  it("asks for the chosen page size, and pages by it rather than by 50", async () => {
    await open(page(10), { hasMore: true });

    await choose(/show/i, "10");
    await press(/apply/i);
    expect(listFirefliesMeetingsAction).toHaveBeenLastCalledWith(
      expect.objectContaining({ limit: 10, skip: 0 }),
    );

    await press(/load the next/i);
    expect(listFirefliesMeetingsAction).toHaveBeenLastCalledWith(
      expect.objectContaining({ limit: 10, skip: 10 }),
    );
  });

  /**
   * The preset resolves to a bound at fetch time rather than when it is picked,
   * so "last 7 days" still means seven days from now on a panel left open. What
   * is pinned here is the shape — a from-bound is sent, no to-bound is — since
   * asserting the literal date would pin the clock instead.
   */
  it("turns a preset into a from-bound with no ceiling", async () => {
    await open([FOUNDER_CALL]);

    await choose(/recorded/i, "7d");
    await press(/apply/i);

    const sent = listFirefliesMeetingsAction.mock.lastCall![0]!;
    expect(sent.fromDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(sent.toDate).toBeUndefined();
  });

  it("sends no bound at all for Any time", async () => {
    await open([FOUNDER_CALL]);

    await choose(/recorded/i, "30d");
    await press(/apply/i);
    await choose(/recorded/i, "any");
    await press(/apply/i);

    expect(listFirefliesMeetingsAction).toHaveBeenLastCalledWith(
      expect.objectContaining({ fromDate: undefined, toDate: undefined }),
    );
  });

  it("only offers the two date boxes once a custom range is chosen", async () => {
    await open([FOUNDER_CALL]);
    expect(screen.queryByLabelText(/^from$/i)).toBeNull();

    await choose(/recorded/i, "custom");
    expect(screen.getByLabelText(/^from$/i)).toBeTruthy();
    expect(screen.getByLabelText(/^to$/i)).toBeTruthy();
  });
});

describe("getting the panel out of the way", () => {
  /**
   * The disclosure, four filters, a page of rows and the import form make this
   * the longest thing on the page — and the paste form lives under it. Closing
   * is what keeps the rest of the screen reachable.
   */
  it("closes the panel and leaves the paste form below it working", async () => {
    await open([FOUNDER_CALL]);
    expect(screen.getByText("Biome <> Aparna")).toBeTruthy();

    await press(/^close$/i);

    expect(screen.queryByText("Biome <> Aparna")).toBeNull();
    expect(screen.queryByLabelText(/^search$/i)).toBeNull();
    // The way back in is the same control it always was.
    expect(screen.getByRole("button", { name: /browse meetings/i })).toBeTruthy();
  });

  it("re-opens on what was already fetched rather than spending another request", async () => {
    await open([FOUNDER_CALL]);
    const callsAfterFirstOpen = listFirefliesMeetingsAction.mock.calls.length;

    await press(/^close$/i);
    await press(/browse meetings/i);

    expect(listFirefliesMeetingsAction.mock.calls).toHaveLength(callsAfterFirstOpen);
    expect(screen.getByText("Biome <> Aparna")).toBeTruthy();
  });

  it("keeps a chosen meeting through a close and re-open", async () => {
    await open([FOUNDER_CALL]);
    await press(/biome <> aparna/i);
    expect(screen.getByText(/importing/i)).toBeTruthy();

    await press(/^close$/i);
    await press(/browse meetings/i);

    expect(screen.getByText(/importing/i)).toBeTruthy();
  });
});

describe("importing a chosen meeting", () => {
  /** R15. Picking a row arms the import; it does not perform one. */
  it("imports nothing until the import button is pressed", async () => {
    await open();

    await press(/Biome <> Aparna/);

    expect(importFirefliesCallAction).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /import onto this deal/i })).toBeTruthy();
  });

  /**
   * R14. The number is prefilled with the next one and stays editable, and the
   * label is prefilled from the meeting title — the same offer AddCallForm makes
   * for a pasted call, because an imported call is a call.
   */
  it("prefills the call number and label, and sends what the PM leaves there", async () => {
    await open();
    await press(/Biome <> Aparna/);

    expect((screen.getByLabelText(/call #/i) as HTMLInputElement).value).toBe("2");
    expect((screen.getByLabelText(/label/i) as HTMLInputElement).value).toBe("Biome <> Aparna");

    await type(/call #/i, "3");
    await type(/label/i, "Second founder call");
    await press(/import onto this deal/i);

    expect(importFirefliesCallAction).toHaveBeenCalledWith({
      dealId: "halten",
      meetingId: "ff-halten-2",
      number: "3",
      label: "Second founder call",
      date: "2026-07-22T09:30:00.000Z",
    });
  });

  /**
   * Two imports in one visit. The prop only moves when the page re-renders, so
   * the number has to count on from what was just saved — offering 2 twice sends
   * the PM into the collision refusal for no reason.
   */
  it("counts the call number on for a second import in the same visit", async () => {
    await open();
    await press(/Biome <> Aparna/);
    await press(/import onto this deal/i);

    await press(/Biome board — Q3/);

    expect((screen.getByLabelText(/call #/i) as HTMLInputElement).value).toBe("3");
  });

  it("confirms the call it created and clears the choice", async () => {
    await open();
    await press(/Biome <> Aparna/);
    await press(/import onto this deal/i);

    expect(screen.getByText(/call 2 imported from fireflies/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /import onto this deal/i })).toBeNull();
  });

  /**
   * AE8 as the PM meets it. The refusal is the server's sentence, naming the
   * call the meeting is already on — the picker adds nothing to it and hides
   * nothing from it.
   */
  it("shows the server's refusal when the meeting is already on the deal", async () => {
    await open();
    importFirefliesCallAction.mockResolvedValue({
      ok: false,
      error: "that Fireflies meeting is already on this deal as call 2",
      field: "meetingId",
    });

    await press(/Biome <> Aparna/);
    await press(/import onto this deal/i);

    expect(screen.getByText(/already on this deal as call 2/i)).toBeTruthy();
  });

  /**
   * The refusal names the meeting that was picked when it fired ("already on
   * this deal as call 2") — true of that meeting and nothing else. Left on
   * screen across a new pick it would still be showing the moment a
   * different, unrelated meeting is chosen, telling the PM a fresh, valid
   * choice is a duplicate.
   */
  it("clears a refused import's error when a different meeting is picked", async () => {
    await open();
    importFirefliesCallAction.mockResolvedValue({
      ok: false,
      error: "that Fireflies meeting is already on this deal as call 2",
      field: "meetingId",
    });

    await press(/Biome <> Aparna/);
    await press(/import onto this deal/i);
    expect(screen.getByText(/already on this deal as call 2/i)).toBeTruthy();

    await press(/Biome board — Q3/);
    expect(screen.queryByText(/already on this deal as call 2/i)).toBeNull();
  });

  it("will not import a meeting with the label emptied", async () => {
    await open();
    await press(/Biome <> Aparna/);

    await type(/label/i, "   ");

    expect(
      screen.getByRole("button", { name: /import onto this deal/i }).hasAttribute("disabled"),
    ).toBe(true);
  });
});

describe("with no Fireflies credential on the deployment", () => {
  /**
   * Stated off rather than absent, for the reason the transcript page already
   * gives about extraction: a missing control is indistinguishable from a page
   * that failed to render, and the reader cannot tell which. R12 is the other
   * half — pasting is untouched by any of this, so the off state points at it.
   */
  it("replaces the control with a chip naming the variable, and leaves pasting alone", async () => {
    render(
      <>
        <ImportFromFireflies dealId="halten" nextNumber={2} firefliesEnabled={false} />
        <AddCallForm dealId="halten" nextNumber={2} extractionEnabled={false} />
      </>,
    );

    expect(screen.getByText(/no FIREFLIES_API_KEY on this deployment/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /browse meetings/i })).toBeNull();
    expect(listFirefliesMeetingsAction).not.toHaveBeenCalled();

    // R12: the paste path is right there and still saves.
    await type(/label/i, "First founder call");
    await act(async () => {
      const ta = screen.getByRole("textbox", { name: "" }) as HTMLTextAreaElement;
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(ta, "Rhea: we ran settlement operations for six years.");
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await press(/save transcript/i);

    expect(addCallAction).toHaveBeenCalledWith({
      dealId: "halten",
      number: "2",
      label: "First founder call",
      transcript: "Rhea: we ran settlement operations for six years.",
    });
  });

  /**
   * KTD10. The key opens every call Biome has recorded, so the component is
   * given a yes/no and has no way to learn anything else: it never reads the
   * environment, and the off state names the variable rather than its value.
   * The page is where the read happens, and a page renders in neither suite —
   * so what is checkable here is that nothing in this file could.
   */
  it("takes availability as a boolean and never reads the credential itself", async () => {
    vi.stubEnv("FIREFLIES_API_KEY", "sentinel-key-value-that-must-not-render");
    try {
      const source = readFileSync(
        path.resolve(__dirname, "ImportFromFireflies.tsx"),
        "utf8",
      );
      expect(source).not.toMatch(/process\.env/);

      await open();
      expect(document.body.innerHTML).not.toContain("sentinel-key-value-that-must-not-render");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
