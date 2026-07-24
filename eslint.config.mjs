import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Agent worktrees created by Claude Code — not part of the source tree:
    ".claude/**",
  ]),
  {
    rules: {
      // These three rules flag patterns that are used as established conventions
      // throughout this codebase (useEffect data-fetch triggers, inline component
      // definitions, direct setState in effects). Suppressed globally to avoid
      // ~50 per-line disable directives across existing files.
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/static-components": "off",
      "react-hooks/immutability": "off",
      // `any` is used intentionally in several Supabase RPC response casts.
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
]);

export default eslintConfig;
