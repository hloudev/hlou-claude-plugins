import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, it } from 'node:test';

import { makeBundle, repoRoot } from './lib/testing.mjs';
import { readZip } from './lib/zip.mjs';
import { packBundle } from './pack.mjs';
import { validateBundle } from './validate.mjs';

const EXPECTED = [
  'hlou-handoff.json',
  'assets/hero.png',
  'assets/logo.svg',
  'pages/home.html',
  'renders/home.png',
];

function hasUnzip() {
  return spawnSync('unzip', ['-v'], { stdio: 'ignore' }).status === 0;
}

function resolveFflate() {
  if (!repoRoot) return null;
  for (const from of ['package.json', 'packages/feature-portability/package.json']) {
    try {
      return createRequire(path.join(repoRoot, from)).resolve('fflate');
    } catch {
      /* next */
    }
  }
  return null;
}

describe('packBundle', () => {
  const dir = makeBundle((_, files) => {
    files['NOTES.md'] = 'left out';
  });

  it('writes the manifest first, then the files sorted, and leaves notes out', () => {
    const { entries } = readZip(packBundle(dir));
    assert.deepEqual(
      entries.map((entry) => entry.name),
      EXPECTED
    );
    for (const entry of entries)
      assert.deepEqual(entry.read(), readFileSync(path.join(dir, entry.name)), entry.name);
    const method = Object.fromEntries(entries.map((entry) => [entry.name, entry.method]));
    assert.equal(method['assets/hero.png'], 0);
    assert.equal(method['pages/home.html'], 8);
  });

  it('is deterministic', () => {
    assert.ok(packBundle(dir).equals(packBundle(dir)));
    assert.ok(
      packBundle(dir).equals(
        packBundle(makeBundle((_, files) => void (files['NOTES.md'] = 'other')))
      )
    );
  });

  it('validates as a zip', () => {
    const zip = path.join(dir, 'out.zip');
    writeFileSync(zip, packBundle(dir));
    assert.deepEqual(validateBundle(zip), []);
  });

  it('refuses a bundle that does not validate', () => {
    const broken = makeBundle((manifest) => {
      manifest.pages[0].html = 'home.html';
    });
    assert.throws(() => packBundle(broken), /pagePathOutside/);
  });

  it('round-trips through unzip', { skip: hasUnzip() ? false : 'no unzip on this machine' }, () => {
    const zip = path.join(dir, 'unzip.zip');
    writeFileSync(zip, packBundle(dir));
    const list = spawnSync('unzip', ['-l', zip], { encoding: 'utf8' });
    assert.equal(list.status, 0, list.stderr);
    for (const name of EXPECTED) assert.match(list.stdout, new RegExp(name.replace('.', '\\.')));
    const test = spawnSync('unzip', ['-t', zip], { encoding: 'utf8' });
    assert.equal(test.status, 0, test.stdout);
  });

  const fflate = resolveFflate();
  it(
    'round-trips through fflate',
    { skip: fflate ? false : 'fflate is not resolvable here' },
    async () => {
      const { unzipSync } = await import(fflate);
      const files = unzipSync(new Uint8Array(packBundle(dir)));
      assert.deepEqual(Object.keys(files), EXPECTED);
      for (const name of EXPECTED)
        assert.deepEqual(Buffer.from(files[name]), readFileSync(path.join(dir, name)), name);
    }
  );
});
