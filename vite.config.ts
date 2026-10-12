import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Модуль входа Supabase в Nova не выполняется (вход через Firebase, оба
      // клиента — с `accessToken`), но supabase-js импортирует его всегда.
      // Подменяем пустышкой: минус ~100 КБ из стартового набора. Запросы к базе
      // и хранилищу остаются теми же — `node scripts/check-supabase-auth-stub.mjs`.
      "@supabase/auth-js": path.resolve(__dirname, "./src/lib/supabaseAuthStub.ts"),
    },
  },
  server: {
    port: 5173,
  },
  // mtcute (раздел «Telegram») грузит свой WASM по `new URL(…, import.meta.url)`:
  // предсборка зависимостей в dev ломает этот путь. Сборку это не трогает.
  optimizeDeps: {
    exclude: ["@mtcute/wasm"],
  },
  build: {
    rollupOptions: {
      output: {
        // recharts здесь больше НЕ перечислен. Отдельный chunk «charts» стоял
        // в стартовом наборе у всех (modulepreload в index.html, ≈106 КБ gzip):
        // rollup клал в него clsx — общую зависимость recharts и cn(), — и
        // главный chunk импортировал clsx оттуда. Без ручного chunk recharts
        // уезжает в ленивые chunk'и дашборда/ABS/«Технарей», и качается только
        // когда их открывают. storage и analytics из firebase-chunk убраны
        // вместе с их вызовами в src/firebase/firebase.ts: сайт их не использует.
        manualChunks: {
          firebase: ["firebase/app", "firebase/auth", "firebase/firestore"],
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
