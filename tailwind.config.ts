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
    },
  },
  plugins: [],
};

export default config;
