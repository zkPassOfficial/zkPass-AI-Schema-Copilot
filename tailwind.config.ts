import type { Config } from "tailwindcss";

export default {
  content: ["./src/sidepanel/**/*.{ts,tsx,html}", "./src/options/**/*.{ts,tsx,html}"],
  theme: {
    extend: {},
  },
  plugins: [],
} satisfies Config;
