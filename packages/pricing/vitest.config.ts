import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // types.ts is erased at build time — there is nothing there to execute.
      exclude: ['src/types.ts'],
      // The engine is the institutional asset. It is covered or it does not ship.
      // Calibrated to what the suite actually reaches (100/97.4/100/100), with
      // a little headroom. Raise it when coverage rises; never lower it to get
      // a red build green.
      thresholds: { statements: 100, branches: 97, functions: 100, lines: 100 },
    },
  },
});
