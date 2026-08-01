import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          firebase: ["firebase/app", "firebase/auth", "firebase/firestore", "firebase/storage", "firebase/analytics"],
          charts: ["recharts"],
          "dnd-kit": ["@dnd-kit/core", "@dnd-kit/sortable", "@dnd-kit/utilities", "@dnd-kit/modifiers"],
          motion: ["framer-motion"],
          radix: [
            "@radix-ui/react-dialog",
            "@radix-ui/react-dropdown-menu",
            "@radix-ui/react-select",
            "@radix-ui/react-tooltip",
            "@radix-ui/react-popover",
            "@radix-ui/react-tabs",
            "@radix-ui/react-switch",
            "@radix-ui/react-checkbox",
            "@radix-ui/react-avatar",
            "@radix-ui/react-context-menu",
            "@radix-ui/react-scroll-area",
            "@radix-ui/react-separator",
            "@radix-ui/react-label",
            "@radix-ui/react-slot",
          ],
        },
      },
    },
  },
});
