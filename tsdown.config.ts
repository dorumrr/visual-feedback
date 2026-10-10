import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    server: "src/server/index.ts",
    react: "src/react/index.ts",
  },
  format: "esm",
  target: "es2022",
  dts: true,
  outDir: "dist",
  clean: true,
  // Next.js reads the directive to keep the component out of server rendering.
  banner: (chunk) => (chunk.fileName === "react.mjs" ? '"use client";' : ""),
});
