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
        foundry: {
          bg: "#090b0d",
          ink: "#f3f1ea",
          muted: "#9ca6a5",
          subtle: "#6f7978",
          panel: "rgba(18, 22, 24, 0.78)",
          amber: "#e8b75c",
          teal: "#4fd1bd",
          blue: "#8fb7ff",
        },
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
