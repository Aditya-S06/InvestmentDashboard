import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Unit tests use sentinel environments and must never read local .env files.
  envDir: false,
  resolve: {
    alias: {
      'server-only': path.resolve(__dirname, 'test/stubs/server-only.ts'),
      '@': path.resolve(__dirname),
    },
  },
  test: {
    environment: 'node',
    include: ['lib/**/*.test.ts', 'test/**/*.test.ts'],
  },
});
