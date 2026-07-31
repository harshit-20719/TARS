import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { act } from "react";

/**
 * The extraction tuning form (R17–R20, KTD12, KTD13).
 *
 * What these pin is mostly what the control refuses to offer: a temperature
 * above the cap is never pressable, because the save would be refused and a
 * press whose only outcome is a rejection is worse than an absent button; and
 * where the active provider ignores the parameter entirely, the strip says so
 * rather than letting an admin set a value that never reaches the wire.
 *
 * Named .test.tsx deliberately: vitest.components.config.ts includes only
 * .test.tsx under components/, so a .test.ts here would run in neither suite.
 */

type Result = { ok: true; data?: undefined } | { ok: false; error: string; field?: string };

const saveRubricExtractionConfigAction = vi.fn<(...a: unknown[]) => Promise<Result>>();

vi.mock("@/lib/actions", () => ({
  saveRubricExtractionConfigAction: (...a: unknown[]) => saveRubricExtractionConfigAction(...a),
}));

// ControlError reads the path to build its sign-in-again link.
vi.mock("next/navigation", () => ({ usePathname: () => "/admin/extraction" }));

const { RubricExtractionForm } = await import("./RubricExtractionForm");

function renderForm(overrides: Partial<Parameters<typeof RubricExtractionForm>[0]> = {}) {
  return render(
    <RubricExtractionForm
      rubricKey="ft"
      label="Founder & Team"
      persona=""
      guidance=""
      temperature={0}
      version={null}
      personaMax={500}
      guidanceMax={1500}
      temperatureMax={0.4}
      temperatureApplies
      providerLabel="gemini · gemini-2.5-flash-lite"
      lastRun={null}
      {...overrides}
    />,
  );
}

const persona = () => screen.getByLabelText(/persona/i) as HTMLTextAreaElement;
const guidance = () => screen.getByLabelText(/guidance/i) as HTMLTextAreaElement;
const saveButton = () => screen.getByRole("button", { name: /tuning/i }) as HTMLButtonElement;
const tempButton = (v: string) => screen.getByRole("button", { name: v }) as HTMLButtonElement;

beforeEach(() => {
  saveRubricExtractionConfigAction.mockReset();
  saveRubricExtractionConfigAction.mockResolvedValue({ ok: true });
});

describe("the tuning form", () => {
  it("renders the three controls and is not dirty on load", () => {
    renderForm({ persona: "An operator.", guidance: "Prefer specifics.", temperature: 0.2 });

    expect(persona().value).toBe("An operator.");
    expect(guidance().value).toBe("Prefer specifics.");
    expect(tempButton("0.2").getAttribute("aria-pressed")).toBe("true");
    // Nothing edited yet, so there is nothing to save.
    expect(saveButton().disabled).toBe(true);
  });

  it("saves the rubric key with the edited values once something changes", async () => {
    renderForm();

    await act(async () => {
      persona().focus();
      // React tracks its own value; set through the native setter so onChange fires.
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      )!.set!;
      setter.call(persona(), "A studio operator.");
      persona().dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(saveButton().disabled).toBe(false);

    await act(async () => {
      saveButton().click();
    });

    expect(saveRubricExtractionConfigAction).toHaveBeenCalledWith({
      rubricKey: "ft",
      persona: "A studio operator.",
      guidance: "",
      temperature: 0,
    });
  });

  it("reports the saved version once there is one, and offers no save until edited", () => {
    renderForm({ version: 3, persona: "Saved." });

    expect(screen.getByText(/saved · version 3/i)).toBeTruthy();
    expect(saveButton().textContent).toMatch(/update tuning/i);
  });

  it("renders a validation refusal against the field that caused it", async () => {
    saveRubricExtractionConfigAction.mockResolvedValue({
      ok: false,
      error: "A persona can hold at most 500 characters.",
      field: "persona",
    });
    renderForm({ persona: "old" });

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      )!.set!;
      setter.call(persona(), "new");
      persona().dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      saveButton().click();
    });

    expect(screen.getByText(/at most 500 characters/i)).toBeTruthy();
  });

  /**
   * The cap, expressed as what the strip does not offer. Every rendered step is
   * at or under it — there is no over-cap button to press, unlike the slide
   * control this strip borrows its shape from, because an over-cap temperature
   * is refused rather than banked as provisional.
   */
  it("offers no temperature above the cap", () => {
    renderForm();

    for (const step of ["0.0", "0.1", "0.2", "0.3", "0.4"]) {
      expect(screen.getByRole("button", { name: step })).toBeTruthy();
    }
    expect(screen.queryByRole("button", { name: "0.5" })).toBeNull();
    expect(screen.queryByRole("button", { name: "1.0" })).toBeNull();
    // And the cap is named beside the control rather than left to be discovered.
    expect(screen.getByText(/cap 0\.4/i)).toBeTruthy();
    expect(screen.getByText(/starts buying silence/i)).toBeTruthy();
  });

  it("says so, and disables the strip, when the provider ignores temperature", () => {
    renderForm({ temperatureApplies: false, providerLabel: "anthropic · claude-sonnet-5" });

    expect(screen.getByText(/refuses this parameter/i)).toBeTruthy();
    expect(screen.getByText(/anthropic · claude-sonnet-5/)).toBeTruthy();
    expect(tempButton("0.2").disabled).toBe(true);
    // Persona and guidance are unaffected — only the one parameter is inert.
    expect(persona().disabled).toBe(false);
  });

  it("shows the last run's dropped-quote count with the version it ran under", () => {
    renderForm({ lastRun: { droppedQuotes: 3, configVersion: 2 } });

    expect(screen.getByText(/dropped 3 quotes on this block/i)).toBeTruthy();
    expect(screen.getByText(/version 2/i)).toBeTruthy();
  });

  it("names the defaults when the last run carried no tuning version", () => {
    renderForm({ lastRun: { droppedQuotes: 1, configVersion: null } });

    expect(screen.getByText(/dropped 1 quote on this block/i)).toBeTruthy();
    expect(screen.getByText(/under the defaults/i)).toBeTruthy();
  });

  it("says nothing about drops before the block has ever run", () => {
    renderForm();

    expect(screen.queryByText(/last run dropped/i)).toBeNull();
  });
});
