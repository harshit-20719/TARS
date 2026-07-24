import Link from "next/link";
import { ThemeToggle } from "./ThemeToggle";

export function TopBar() {
  return (
    <header className="topbar">
      <Link href="/deals" className="brand" style={{ textDecoration: "none" }}>
        <span className="brand-name">
          TARS<span className="brand-cursor" aria-hidden="true" />
        </span>
        <span className="brand-sub">Conviction · L1</span>
      </Link>
      <div className="topbar-spacer" />
      <ThemeToggle />
    </header>
  );
}
