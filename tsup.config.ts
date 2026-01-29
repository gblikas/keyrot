import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'app/index.ts',
    client: 'app/client.ts',
  },
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'es2022',
  outDir: 'dist',
});
