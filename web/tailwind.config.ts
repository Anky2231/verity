import type { Config } from "tailwindcss";

// Tailwind is used only by the files in components/ui (the shadcn convention). Two choices keep the rest of the site exactly as it was:
//  - `content` lists only those files, so Tailwind generates only the classes they use and never touches the existing class names
//    (.card, .badge, .menu ...);
//  - `preflight` is off, so Tailwind's global reset is not applied to the existing pages.
// Dark mode follows the visitor's system setting (prefers-color-scheme), the same as the existing styles.
const config: Config = {
  content: ["./components/ui/**/*.{ts,tsx}"],
  darkMode: "media",
  corePlugins: { preflight: false },
  theme: { extend: {} },
  plugins: [],
};

export default config;
