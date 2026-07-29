import { notFound } from "next/navigation";
import { canManageUsers } from "@/lib/authz";
import { isConfiguredAdmin, resolveRole } from "@/lib/adminEmails";
import { listPeople } from "@/lib/data";
import { currentActor } from "@/lib/session";
import { PersonRow, RoleChangeNote } from "@/components/PersonRow";

/**
 * People — who holds an account, and what role they hold (R2, R6).
 *
 * The first ADMIN-only route in the app, which makes it the first place
 * route-level role gating matters at all. Middleware authorizes on session
 * presence alone (`authorized({auth}) => Boolean(auth?.user)`), so it will let a
 * PM through to any path under /admin; the assertion has to live here. Every
 * future /admin route has to make it for itself.
 *
 * `notFound` rather than a "you cannot see this" page: a PM has no business
 * knowing the route exists, and the difference between forbidden and absent is
 * the difference between a hint and nothing.
 *
 * This gate is not the boundary either. `setRoleAction` requires ADMIN again and
 * `setRole` asserts a third time, because rendering no page does not stop anyone
 * from calling the action — server actions are public endpoints.
 */
export default async function PeoplePage() {
  const actor = await currentActor();
  if (!actor || !canManageUsers(actor.role)) notFound();

  const people = await listPeople();

  /**
   * Stored ADMIN rows, which is what KTD12 counts.
   *
   * Not addresses in ADMIN_EMAILS: one of those may belong to someone who has
   * never signed in and so holds no row at all, and counting them would let the
   * page offer a demotion the service is right to refuse.
   */
  const storedAdmins = people.filter((p) => p.role === "ADMIN").length;

  return (
    <main className="main">
      <div className="page">
        <div className="page-head">
          <span className="eyebrow">Admin · Access</span>
          <h1 className="page-title">People</h1>
          <p className="page-lede">
            Everyone who holds an account, and the role each one carries. A role is a label
            describing who someone is rather than a restriction on what they can author — every
            role scores and slides the record. ADMIN is the one that adds this page.
          </p>
        </div>

        <div className="callout neutral">
          <span className="co-badge">Takes effect later</span>
          <RoleChangeNote />
        </div>

        <div className="card">
          <div className="card-head">
            <h2>Accounts</h2>
            <span className="count">
              {people.length} {people.length === 1 ? "person" : "people"} · {storedAdmins} ADMIN
            </span>
          </div>
          <div className="card-body flush">
            <div className="tbl-wrap">
              <table className="tbl people-tbl">
                <thead>
                  <tr>
                    <th>Person</th>
                    <th>Stored role</th>
                    {/*
                      Named for when it lands, not "effective role" — that would
                      read as effective right now, which is the one thing it is
                      not while the person's session is still alive (KTD7).
                    */}
                    <th>Effective role</th>
                    <th>Added</th>
                  </tr>
                </thead>
                <tbody>
                  {people.map((person) => (
                    <PersonRow
                      key={person.id}
                      person={person}
                      effectiveRole={resolveRole(person.email, person.role)}
                      configuredAdmin={isConfiguredAdmin(person.email)}
                      lastAdmin={person.role === "ADMIN" && storedAdmins <= 1}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="card-note">
            Nobody is provisioned here. A Biome colleague signing in for the first time gets a row
            and the PM role automatically — this page is for changing one afterwards.
          </div>
        </div>
      </div>
    </main>
  );
}
