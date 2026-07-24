import type { Config } from "tailwindcss";

// The bespoke visual system (white/black + orange, warm neutrals) lives as
// CSS custom properties in app/globals.css. Tailwind is available for layout
// utilities; design tokens are surfaced here so utilities can reference them.
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
    "./framework/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        canvas: "var(--canvas)",
        surface: "var(--surface)",
        ink: "var(--ink)",
        line: "var(--line)",
        accent: "var(--accent)",
      },
      fontFamily: {
        ui: "var(--font-ui)",
        data: "var(--font-data)",
      },
    },
  },
  plugins: [],
};

export default config;
