"use client";

import { useTransition } from "react";
import Link from "next/link";
import { signOutAction } from "@/lib/actions";
import type { RoleName } from "@/lib/adminEmails";
import { personLabel } from "./ui";

/**
 * Who you are signed in as, and the way out.
 *
 * An inline group rather than a dropdown: the app has no menu pattern anywhere
 * else, and one action does not justify introducing the first.
 *
 * The role arrives as a plain string from lib/adminEmails rather than Prisma's
 * `Role` enum. That enum is a value import, and importing it here would pull
 * Prisma toward the browser bundle for the sake of three literals.
 */
export function UserChip({
  name,
  email,
  role,
  canManageUsers = false,
}: {
  name: string | null;
  email: string;
  role: RoleName;
  /**
   * Decided by `lib/authz` on the server and passed as a boolean, rather than
   * re-derived here from `role`. Restating the rule client-side is how the two
   * copies drift, and this component has no business knowing what ADMIN means.
   */
  canManageUsers?: boolean;
}) {
  const [pending, startTransition] = useTransition();

  const label = personLabel(name, email);

  return (
    <div className="userchip">
      <span className="userchip-name" title={email}>
        {label}
      </span>
      <span className="userchip-role">{role}</span>
      {/*
        The people page has no other way in. It is one route, visited rarely, and
        a link only an ADMIN can see costs less than a page an ADMIN has to
        remember the URL of.
      */}
      {canManageUsers && (
        <Link className="ghostbtn" href="/admin/people">
          People
        </Link>
      )}
      <button
        type="button"
        className="ghostbtn"
        disabled={pending}
        onClick={() => startTransition(() => void signOutAction())}
      >
        {pending ? "Signing out…" : "Sign out"}
      </button>
    </div>
  );
}
