import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Segoe UI", "ui-sans-serif", "system-ui", "-apple-system", "BlinkMacSystemFont", "Arial", "sans-serif"],
        serif: ["Iowan Old Style", "Palatino Linotype", "Palatino", "Book Antiqua", "Georgia", "serif"],
      },
      colors: {
        // Every token resolves through a CSS variable holding a space-separated RGB triplet, so the
        // whole palette swaps per theme (see app/globals.css) while Tailwind's `/alpha` modifiers
        // keep working — e.g. `border-foundry-teal/35`.
        foundry: {
          bg: "rgb(var(--foundry-bg) / <alpha-value>)",
          ink: "rgb(var(--foundry-ink) / <alpha-value>)",
          muted: "rgb(var(--foundry-muted) / <alpha-value>)",
          subtle: "rgb(var(--foundry-subtle) / <alpha-value>)",
          panel: "rgb(var(--foundry-panel) / <alpha-value>)",
          surface: "rgb(var(--foundry-surface) / <alpha-value>)",
          raised: "rgb(var(--foundry-raised) / <alpha-value>)",
          amber: "rgb(var(--foundry-amber) / <alpha-value>)",
          teal: "rgb(var(--foundry-teal) / <alpha-value>)",
          blue: "rgb(var(--foundry-blue) / <alpha-value>)",
        },
        /**
         * Theme-aware replacements for literal `white/x` and `black/x` overlays. The app expresses
         * depth with hundreds of translucent overlays; on a dark base those lift a surface (white),
         * on a light base they must deepen it (slate). Routing them through variables is what makes
         * a real light theme possible without hand-editing every call site.
         */
        overlay: "rgb(var(--foundry-overlay) / <alpha-value>)",
        shade: "rgb(var(--foundry-shade) / <alpha-value>)",
      },
      boxShadow: {
        workspace: "0 24px 70px rgba(0, 0, 0, 0.42)",
      },
      keyframes: {
        settle: { from: { opacity: "0", transform: "translateY(4px)" }, to: { opacity: "1", transform: "translateY(0)" } },
        "chip-in": { from: { opacity: "0", transform: "translateY(6px) scale(0.98)" }, to: { opacity: "1", transform: "translateY(0) scale(1)" } },
        breathe: { "0%, 100%": { transform: "scale(1)", opacity: "1" }, "50%": { transform: "scale(1.14)", opacity: "0.75" } },
        reveal: { from: { opacity: "0", transform: "translateX(-4px)" }, to: { opacity: "1", transform: "translateX(0)" } },
      },
      animation: {
        settle: "settle 0.5s ease both",
        "chip-in": "chip-in 0.42s cubic-bezier(0.2, 0.7, 0.3, 1) both",
        breathe: "breathe 2.2s ease-in-out infinite",
        "breathe-slow": "breathe 2.4s ease-in-out infinite",
        reveal: "reveal 0.5s ease both",
      },
    },
  },
  plugins: [],
};

export default config;
