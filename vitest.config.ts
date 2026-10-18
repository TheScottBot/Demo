import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['./vitest.setup.ts'],
    include: [
      'packages/*/test/**/*.test.ts',
      'infra/test/**/*.test.ts',
      'services/*/test/**/*.test.ts',
      'tree-checks/test/**/*.test.ts',
    ],
  },
});
