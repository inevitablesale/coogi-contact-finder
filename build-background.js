const esbuild = require('esbuild');

esbuild.build({
  entryPoints: ['public/background.js'],
  bundle: true,
  platform: 'browser',
  format: 'esm', // output ES module format for manifest v3 service worker
  outfile: 'public/dist/background.js',
  minify: true,
  sourcemap: true,
}).catch(() => process.exit(1));