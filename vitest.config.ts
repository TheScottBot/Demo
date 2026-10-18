import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['./vitest.setup.ts'],
    include: [
      'packages/*/test/**/*.test.ts',
      'infra/test/**/*.test.ts',
      // Deployed checks keep the names their specifications give them (RE6).
      'infra/test/**/*.spec.ts',
      'services/*/test/**/*.test.ts',
      'tree-checks/test/**/*.test.ts',
    ],
  },
});
