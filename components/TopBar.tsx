import Link from "next/link";
import { ThemeToggle } from "./ThemeToggle";

export function TopBar() {
  return (
    <header className="topbar">
      <Link href="/deals" className="brand" style={{ textDecoration: "none" }}>
        <div className="brand-mark">T</div>
        <div className="brand-name">TARS</div>
        <span className="brand-sub">Conviction · L1</span>
      </Link>
      <div className="topbar-spacer" />
      <ThemeToggle />
    </header>
  );
}
