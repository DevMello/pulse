#!/usr/bin/env node
/**
 * Builds src/tracker/px.js -> public/px.js
 *
 * The size budget is enforced here rather than watched by hand, because a
 * tracker only stays small if growing it is an error rather than a decision
 * somebody has to remember to object to in review.
 *
 *   npm run build:tracker    build, enforce the budget
 *   npm run size             build and print the size report
 */
import { build } from 'esbuild';
import { gzipSync, brotliCompressSync } from 'node:zlib';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const entry = resolve(root, 'src/tracker/px.js');
const outfile = resolve(root, 'public/px.js');

// Section 4.2: ~1 KB target, ~2 KB hard ceiling. We fail at the ceiling and
// nag past the target.
const TARGET_GZIP = 1024;
const CEILING_GZIP = 2048;

mkdirSync(resolve(root, 'public'), { recursive: true });

const result = await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  minify: true,
  format: 'iife',
  // The tracker must run on whatever the host site's visitors are using, and
  // it has no polyfills. es2018 covers >98% of live browsers while still
  // letting esbuild shorten arrow functions and template literals.
  target: ['es2018'],
  legalComments: 'none',
  logLevel: 'warning',
  metafile: true,
});

const code = readFileSync(outfile);
const gzip = gzipSync(code, { level: 9 }).length;
const brotli = brotliCompressSync(code).length;

const fmt = (n) => `${n} B (${(n / 1024).toFixed(2)} KB)`;
const report = [
  `  raw     ${fmt(code.length)}`,
  `  gzip    ${fmt(gzip)}   target ${TARGET_GZIP} B, ceiling ${CEILING_GZIP} B`,
  `  brotli  ${fmt(brotli)}`,
].join('\n');

console.log(`\npx.js\n${report}\n`);

if (gzip > CEILING_GZIP) {
  console.error(
    `px.js is ${gzip} B gzipped, over the ${CEILING_GZIP} B hard ceiling.\n` +
      `This script runs on other people's sites. Cut something, or raise the\n` +
      `ceiling deliberately in scripts/build-tracker.mjs with a reason.\n`
  );
  process.exit(1);
}

if (gzip > TARGET_GZIP) {
  console.warn(
    `Note: px.js is ${gzip} B gzipped, past the ${TARGET_GZIP} B target but ` +
      `under the ${CEILING_GZIP} B ceiling.\n`
  );
}

if (process.argv.includes('--report')) {
  writeFileSync(
    resolve(root, 'public/px.js.meta.json'),
    JSON.stringify(result.metafile, null, 2)
  );
}
