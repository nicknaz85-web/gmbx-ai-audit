import type { Config } from "tailwindcss";

/* Parallax palette. Hex values (not CSS vars) so opacity modifiers like
   `bg-pos/10` and `border-accent/40` work out of the box. The same values are
   mirrored as CSS custom properties in globals.css for use inside component
   classes and SVG (var(--color-*)). */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0a0b0d",
        "bg-2": "#0d0f12",
        surface: "#101317",
        "surface-2": "#15181d",
        "surface-3": "#1b1f26",
        line: "#20252d",
        "line-2": "#2a313b",
        text: "#e8eaed",
        muted: "#888f9b",
        faint: "#565c67",
        pos: "#2eb37c",
        "pos-soft": "#163a2c",
        neg: "#e05561",
        "neg-soft": "#3a1c22",
        accent: "#6c8cff",
        warn: "#d9a441",
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "Helvetica", "Arial", "sans-serif"],
        mono: ["ui-monospace", "SF Mono", "JetBrains Mono", "Cascadia Mono", "Menlo", "Consolas", "monospace"],
      },
      borderRadius: {
        DEFAULT: "7px",
      },
      maxWidth: {
        "screen-2xl": "1400px",
      },
    },
  },
  plugins: [],
};

export default config;
