import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // tsconfig sets jsx: "preserve" because Next owns the transform in the real
  // build. Tests render components directly, so esbuild needs the automatic
  // runtime here — otherwise JSX compiles to a bare React.createElement call
  // and blows up with "React is not defined".
  esbuild: { jsx: 'automatic' },
  resolve: {
    // Mirrors the `@/*` -> `./src/*` mapping in tsconfig.json, so tests can
    // import modules the same way the app does.
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Flows mutate a shared module-level fetch stub; keep files isolated.
    isolate: true,
  },
});
