import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      // The package's CJS entry requires ESM-only cborg; use the ESM build
      // and let Vite resolve its extensionless relative imports.
      '@gandlaf21/bc-ur': '@gandlaf21/bc-ur/dist/lib/es6/index.js',
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.{js,ts}'],
    setupFiles: ['tests/setup.js'],
    server: {
      deps: {
        inline: ['@gandlaf21/bc-ur'],
      },
    },
  },
})
