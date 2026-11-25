const { readFileSync, existsSync, mkdirSync, rmSync } = require('fs');
const { parse, resolve } = require('path');
const { execFileSync } = require('child_process');

try {
  // The source zip is the commit, so a change not yet committed would be in
  // the build but not in its source
  const changes = execFileSync('git', ['status', '--porcelain'], {
    cwd: __dirname,
    encoding: 'utf8',
  });
  if (changes) {
    throw new Error(
      `Commit or stash these changes first, so the source zip matches the build:\n${changes}`
    );
  }

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

  // The committed source the build came from, for Firefox's review: what
  // GitHub's "Download ZIP" gives, but of exactly this commit
  const sourceFilename = `${base}-v${version}-source.zip`;
  execFileSync(
    'git',
    [
      'archive',
      '--format=zip',
      `--prefix=${base}-v${version}/`,
      '-o',
      resolve(__dirname, outdir, sourceFilename),
      'HEAD',
    ],
    { cwd: __dirname, stdio: 'inherit' }
  );

  console.log(
    `Success! Created ${filename} (upload it to the web stores) and ${sourceFilename} (Firefox's source code upload) under the ${outdir} directory.`
  );
} catch (e) {
  console.error(`Error! Failed to generate the zip files. ${e.message}`);
  process.exitCode = 1;
}
