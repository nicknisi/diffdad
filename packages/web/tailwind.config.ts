import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: "#6565EC",
      },
      fontFamily: {
        sans: ["Untitled Sans", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["IBM Plex Mono", "ui-monospace", "monospace"],
        serif: ["Source Serif 4", "ui-serif", "Georgia", "serif"],
      },
    },
  },
  plugins: [],
};

export default config;
