const { readFileSync, existsSync, mkdirSync, rmSync } = require('fs');
const { parse, resolve } = require('path');
const { execFileSync } = require('child_process');

try {
  const { base } = parse(__dirname);
  const { version } = JSON.parse(
    readFileSync(resolve(__dirname, 'build', 'manifest.json'), 'utf8')
  );

  const outdir = 'release';
  const filename = `${base}-v${version}.zip`;
  const zipPath = resolve(__dirname, outdir, filename);
  if (!existsSync(outdir)) {
    mkdirSync(outdir);
  }
  // zip adds to an existing archive, which would keep files removed from build/
  rmSync(zipPath, { force: true });
  execFileSync('zip', ['-r', '-X', '-q', zipPath, '.', '-x', '*.DS_Store'], {
    cwd: resolve(__dirname, 'build'),
    stdio: 'inherit',
  });

  console.log(
    `Success! Created a ${filename} file under ${outdir} directory. You can upload this file to web store.`
  );
} catch (e) {
  console.error('Error! Failed to generate a zip file.');
}
