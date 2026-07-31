import Link from "next/link";
import { canManageUsers, canTuneExtraction } from "@/lib/authz";
import { currentActor } from "@/lib/session";
import { ThemeToggle } from "./ThemeToggle";
import { UserChip } from "./UserChip";

/**
 * Rendered from app/layout.tsx, so making it async is what puts identity on
 * every screen at once (R1).
 *
 * The actor can be null on the sign-in page, which layout also wraps — the chip
 * is simply absent there rather than rendering an empty shape.
 */
export async function TopBar() {
  const actor = await currentActor();

  return (
    <header className="topbar">
      <Link href="/deals" className="brand" style={{ textDecoration: "none" }}>
        <span className="brand-name">
          TARS<span className="brand-cursor" aria-hidden="true" />
        </span>
        <span className="brand-sub">Conviction · L1</span>
      </Link>
      <div className="topbar-spacer" />
      {actor && (
        <UserChip
          name={actor.name}
          email={actor.email}
          role={actor.role}
          canManageUsers={canManageUsers(actor.role)}
          canTuneExtraction={canTuneExtraction(actor.role)}
        />
      )}
      <ThemeToggle />
    </header>
  );
}
