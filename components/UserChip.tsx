"use client";

import { useTransition } from "react";
import { signOutAction } from "@/lib/actions";
import type { RoleName } from "@/lib/adminEmails";

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
}: {
  name: string | null;
  email: string;
  role: RoleName;
}) {
  const [pending, startTransition] = useTransition();

  // A blank chip reads as signed out. Google supplies a name, but the dev
  // credentials provider and a freshly adapter-created row need not.
  const label = name?.trim() || email.split("@")[0];

  return (
    <div className="userchip">
      <span className="userchip-name" title={email}>
        {label}
      </span>
      <span className="userchip-role">{role}</span>
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
