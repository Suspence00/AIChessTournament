import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        arena: {
          bg: "#0e141b",
          card: "#121b26",
          accent: "#4dd0e1",
          accent2: "#a78bfa",
          muted: "#94a3b8"
        }
      },
      boxShadow: {
        card: "0 10px 30px rgba(0,0,0,0.25)"
      }
    }
  },
  plugins: []
};

export default config;
