"use client";

import { usePathname } from "next/navigation";

/**
 * A refused save, rendered next to the control that caused it.
 *
 * Eleven controls rendered this identically before it lived here — the same
 * `<div className="ctl-err">` around the same string — so a change to how a
 * failure reads meant eleven edits, and the reason this component exists is
 * exactly such a change.
 *
 * When the failure is an ended session (R23, AE10) the message is not something
 * the person can act on by editing their input, so it carries a way back. The
 * link goes to Auth.js's sign-in route with the current path as `callbackUrl`,
 * so signing in returns them to the page they were on rather than the deals
 * list. That route is reachable without a session: middleware's matcher excludes
 * `api/auth`, which is what makes the offer work at all.
 */
export function ControlError({
  error,
  reauth = false,
  as: Tag = "div",
  style,
}: {
  error: string | null;
  reauth?: boolean;
  /** A `span` where the surrounding layout is inline; `div` otherwise. */
  as?: "div" | "span";
  style?: React.CSSProperties;
}) {
  const pathname = usePathname();
  if (!error) return null;

  return (
    <Tag className="ctl-err" style={style}>
      {error}
      {reauth && (
        <>
          {" "}
          <a className="ctl-err-link" href={`/api/auth/signin?callbackUrl=${encodeURIComponent(pathname)}`}>
            Sign in again
          </a>
        </>
      )}
    </Tag>
  );
}
