const esbuild = require('esbuild');

esbuild.build({
  entryPoints: ['public/background.js'],
  bundle: true,
  outfile: 'public/dist/background.js',
  platform: 'neutral',           // no node/browser specific shims
  format: 'iife',                // immediately invoked function expression
  minify: true,
  sourcemap: true,
  external: ['@supabase/supabase-js'],  // exclude Supabase since loaded via CDN
}).catch(() => process.exit(1));