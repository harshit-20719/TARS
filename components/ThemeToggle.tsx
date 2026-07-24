"use client";

import { useEffect } from "react";
import { Icon } from "./icons";

export function ThemeToggle() {
  useEffect(() => {
    const saved = localStorage.getItem("tars-theme");
    if (saved === "dark" || saved === "light") {
      document.documentElement.setAttribute("data-theme", saved);
    }
  }, []);

  function toggle() {
    const root = document.documentElement;
    const cur = root.getAttribute("data-theme");
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const next = cur === "dark" ? "light" : cur === "light" ? "dark" : prefersDark ? "light" : "dark";
    root.setAttribute("data-theme", next);
    localStorage.setItem("tars-theme", next);
  }

  return (
    <button className="iconbtn" onClick={toggle} aria-label="Toggle light or dark theme" title="Toggle theme">
      <Icon name="sun" />
    </button>
  );
}
