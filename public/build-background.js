const esbuild = require('esbuild');

esbuild.build({
  entryPoints: ['public/background.js'],
  bundle: true,
  outfile: 'public/dist/background.js',
  platform: 'neutral',
  format: 'iife',
  minify: true,
  sourcemap: true,
  external: ['@supabase/supabase-js'],
}).catch(() => process.exit(1));