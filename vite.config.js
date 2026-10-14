// Builds the plugin into dist/: main.js (one ES module: the code, Svelte and the styles in it) and manifest.json.
// Put the dist folder into the app's folder of plugins as plugins/<id>/.
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  root: here('.'),
  plugins: [
    svelte({ compilerOptions: { css: 'injected' } }), // the components' styles go with the code
    { name: 'manifest', closeBundle: () => copyFileSync(here('./manifest.json'), here('./dist/manifest.json')) },
  ],
  // the types and `definePlugin`: a copy of the app's src/api/index.ts
  resolve: { alias: { '@panopticon/api': here('./panopticon-api.ts') } },
  build: {
    outDir: here('./dist'),
    emptyOutDir: true,
    minify: false,
    lib: { entry: here('./src/main.ts'), formats: ['es'], fileName: () => 'main.js' },
  },
});
