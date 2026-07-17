import { build } from 'esbuild';

const entryPoints = ['src/index.ts', 'src/react.ts', 'src/vue.ts', 'src/svelte.ts'];

// External so a bundler dedupes against the app's own copy instead of shipping
// a second React.
const external = ['react'];

const shared = {
  entryPoints,
  bundle: true,
  minify: true,
  sourcemap: true,
  target: ['es2018'],
  external,
  logLevel: 'info',
};

await build({ ...shared, format: 'esm', outdir: 'dist', outExtension: { '.js': '.js' } });
await build({ ...shared, format: 'cjs', outdir: 'dist', outExtension: { '.js': '.cjs' } });

console.log('@pulse/sdk built');
