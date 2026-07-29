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

const listFirefliesMeetingsAction =
  vi.fn<(o?: { search?: string; skip?: number; limit?: number }) => Promise<Result<Meeting[]>>>();
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

const type = (labelText: RegExp, value: string) =>
  act(async () => {
    const input = screen.getByLabelText(labelText) as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });

/** Open the picker with the given answer already queued. */
async function open(meetings: Meeting[] = [FOUNDER_CALL, BOARD_CALL]) {
  listFirefliesMeetingsAction.mockResolvedValue({ ok: true, data: meetings });
  mount();
  await press(/browse meetings/i);
}

beforeEach(() => {
  listFirefliesMeetingsAction.mockReset();
  importFirefliesCallAction.mockReset();
  addCallAction.mockClear();
  listFirefliesMeetingsAction.mockResolvedValue({ ok: true, data: [] });
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
    // A scope would be a select; the only field on the panel is the search box.
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
  });

  it("names who will be recorded against the import", async () => {
    await open();

    const reach = screen.getByText(/every call biome has recorded/i).parentElement!;
    expect(reach.textContent).toMatch(/records who imported it/i);
  });
});

describe("the five states", () => {
  it("shows a pending state while the list loads", async () => {
    let answer!: (r: Result<Meeting[]>) => void;
    listFirefliesMeetingsAction.mockImplementationOnce(
      () => new Promise<Result<Meeting[]>>((resolve) => (answer = resolve)),
    );
    mount();

    await press(/browse meetings/i);
    expect(screen.getByText(/reading fireflies/i)).toBeTruthy();

    await act(async () => answer({ ok: true, data: [FOUNDER_CALL] }));
    expect(screen.queryByText(/reading fireflies/i)).toBeNull();
  });

  it("says the account has no recordings rather than showing an empty list", async () => {
    await open([]);

    expect(screen.getByText(/fireflies has no recordings on this account yet/i)).toBeTruthy();
  });

  it("names the search term that matched nothing, and offers a way to clear it", async () => {
    await open([FOUNDER_CALL]);
    listFirefliesMeetingsAction.mockResolvedValue({ ok: true, data: [] });

    await type(/search/i, "aparna");
    await press(/^search$/i);

    expect(screen.getByText(/no meeting matches “aparna”/i)).toBeTruthy();

    listFirefliesMeetingsAction.mockResolvedValue({ ok: true, data: [FOUNDER_CALL] });
    await press(/clear search/i);
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

    listFirefliesMeetingsAction.mockResolvedValue({ ok: true, data: [FOUNDER_CALL] });
    await press(/try again/i);
    expect(screen.getByText("Biome <> Aparna")).toBeTruthy();
  });

  /**
   * Fireflies pages at 50 with no total and no cursor, so "there may be more" is
   * a fact about the API the reader has to be told — a bare "next" button would
   * leave them guessing whether the list they are searching is all of it.
   */
  it("states the page size and asks Fireflies for the next 50", async () => {
    await open(page(50));

    expect(screen.getByText(/fireflies returns 50 meetings at a time/i)).toBeTruthy();

    listFirefliesMeetingsAction.mockResolvedValue({ ok: true, data: [FOUNDER_CALL] });
    await press(/load the next 50/i);

    expect(listFirefliesMeetingsAction).toHaveBeenLastCalledWith({ search: undefined, skip: 50 });
    // Appended, not replaced — paging forward must not lose the page above it.
    expect(screen.getAllByRole("listitem")).toHaveLength(51);
    // And a short page is the end of it, so the offer goes away.
    expect(screen.queryByRole("button", { name: /load the next 50/i })).toBeNull();
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
    listFirefliesMeetingsAction.mockResolvedValue({ ok: true, data: [FOUNDER_CALL] });

    await type(/search/i, "aparna@halten.com");
    await press(/^search$/i);

    expect(listFirefliesMeetingsAction).toHaveBeenLastCalledWith({
      search: "aparna@halten.com",
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
