"use client";

import { setRoleAction } from "@/lib/actions";
import { useAction } from "@/lib/useAction";
import { ControlError } from "./ControlError";
import type { RoleName } from "@/lib/adminEmails";
import type { Person } from "@/mock/types";
import { personLabel } from "./ui";

/**
 * One person, and the role they hold (R2, R3, R4).
 *
 * Two role columns, because the two can disagree and the difference is the whole
 * point. The stored role is what the database says; the effective role is what
 * `resolveRole` resolves it to, which for an address in ADMIN_EMAILS is ADMIN
 * whatever the row says. Showing only the stored role would misreport who can
 * manage users — and showing only the resolved one would hide the row that is
 * being overwritten.
 *
 * It says "effective" because it now is. This column was called "at next
 * sign-in" while authorization read the role off the token, which only refreshed
 * at sign-in; `currentActor` reads the stored row every request, so a change
 * lands on the person's next request rather than their next session.
 *
 * Lives in flat components/ rather than components/authoring/, which is for
 * mutations of the deal record. This mutates users.
 */

const ROLES: RoleName[] = ["PM", "PARTNER", "ADMIN"];

/**
 * What pressing a role actually does (R3).
 *
 * Rendered by the people page, but declared here so it cannot drift away from
 * the control it qualifies — the same reason SESSION_ENDED_MESSAGE lives beside
 * the hook that raises it.
 */
export function RoleChangeNote() {
  return (
    <span>
      A role change is written now and takes effect on that person&apos;s <b>next request</b> —
      they do not need to sign out and back in. An address listed in <code>ADMIN_EMAILS</code>
      outranks the stored role and cannot be changed here.
    </span>
  );
}

export function PersonRow({
  person,
  effectiveRole,
  configuredAdmin = false,
  lastAdmin = false,
}: {
  person: Person;
  /** `resolveRole(email, storedRole)` — computed on the server, where the env is. */
  effectiveRole: RoleName;
  /** Listed in ADMIN_EMAILS, so a demotion here would be overridden anyway. */
  configuredAdmin?: boolean;
  /** The only stored ADMIN left. Demoting them would leave nobody able to manage users. */
  lastAdmin?: boolean;
}) {
  const setRole = useAction(setRoleAction);

  const label = personLabel(person.name, person.email);

  /**
   * Why this row cannot be changed, or nothing.
   *
   * The two cases are one situation to whoever is reading: the control does not
   * work, and they need to know that before pressing it rather than after. The
   * configured-admin case is checked first because it is the one with a fix —
   * edit ADMIN_EMAILS — while the last-ADMIN case is fixed by promoting someone.
   *
   * Neither of these is the boundary. lib/services/people.ts refuses both again,
   * because a server action is a public endpoint and a control that is not
   * rendered is not an authorization check.
   */
  const fixedBecause = configuredAdmin
    ? "configured in ADMIN_EMAILS"
    : lastAdmin
      ? "last remaining ADMIN"
      : null;

  return (
    <tr>
      <td>
        <div className="person-name">{label}</div>
        <div className="person-email">{person.email}</div>
      </td>

      <td aria-label={`Stored role ${person.role}`}>
        {fixedBecause ? (
          /*
            Stated off rather than absent, and rather than a greyed-out control.
            A missing control is indistinguishable from a broken page, and a
            disabled one says "no" without saying why — the same reasoning the
            transcript page uses for its extraction chip.
          */
          <span className="chip pending">
            <span className="dot" />
            {person.role} · fixed, {fixedBecause}
          </span>
        ) : (
          <div className="seg" role="group" aria-label={`Role for ${label}`}>
            {ROLES.map((role) => (
              <button
                key={role}
                type="button"
                aria-pressed={role === person.role}
                disabled={setRole.pending}
                onClick={() => {
                  // Pressing the role already held is a mis-click, not a change.
                  // Sending it would write the same row and revalidate the page
                  // for nothing.
                  if (role !== person.role) void setRole.run(person.id, role);
                }}
              >
                {role}
              </button>
            ))}
          </div>
        )}
        {/*
          No optimistic value here, unlike ScoreControl. That control is pressed
          forty-one times in a sitting and a round trip between click and feedback
          reads as a broken app; this one is pressed once in a while, and showing
          a role the server has not agreed to would be the wrong risk to take with
          a permission.
        */}
        {setRole.pending && <span className="ctl-saving">saving…</span>}
        <ControlError error={setRole.error} reauth={setRole.reauth} />
      </td>

      <td aria-label={`Effective role ${effectiveRole}`}>
        <span className={`chip ${effectiveRole === person.role ? "line" : "accent"} mono`}>
          {effectiveRole}
        </span>
      </td>

      <td className="person-added">{person.created}</td>
    </tr>
  );
}
