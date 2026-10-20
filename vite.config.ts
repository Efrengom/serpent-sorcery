import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Resolve the real path so builds work when the project lives behind a
// redirected/symlinked folder (e.g. Windows app-virtualized AppData paths).
const root = realpathSync.native(fileURLToPath(new URL('.', import.meta.url)));

export default defineConfig({
  root,
  plugins: [react()],
  test: {
    environment: 'node',
  },
});
