// Parity fixture generator — NOT part of `npm test`. Runs the TypeScript
// engines on shared sample inputs and writes their outputs to
// ios/parity/fixtures/*.json, which the Swift port (ios/LiftLogCore) must
// reproduce exactly. Regenerate with `npm run parity:fixtures`.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: fileURLToPath(new URL('../..', import.meta.url)),
  test: {
    environment: 'node',
    setupFiles: ['./src/test/setup.ts'],
    include: ['ios/parity/cases/**/*.parity.ts'],
    // Fixtures are written by the cases themselves; one file per engine.
    fileParallelism: false,
  },
});
