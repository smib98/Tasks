import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      boxShadow: {
        note: "0 20px 36px rgba(17, 24, 39, 0.08)",
        panel: "0 12px 40px rgba(18, 26, 37, 0.08)"
      }
    }
  },
  plugins: []
};

export default config;
