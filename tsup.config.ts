import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['app/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'es2022',
  outDir: 'dist',
});
