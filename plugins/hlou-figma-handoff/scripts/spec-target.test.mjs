/*
 * The spec target (decision 221): finding a Hlou starter, placing media
 * without replacing any, and — inside the Hlou repository — the example spec
 * (the contract's minimal fixture, written as a spec) validating and
 * compiling with the renderer's own compiler, its media placed by the script.
 */

import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  detectTarget,
  mediaFileName,
  placeMedia,
  SPEC_KEY,
  SPEC_MEDIA_PATH,
  SPEC_SITE_PATH,
} from './lib/spec-target.mjs';
import { CONTRACT_FIXTURES, repoPath, repoRoot } from './lib/testing.mjs';
import { mediaMap } from './spec-target.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const EXAMPLE_SPEC = path.join(here, '..', 'reference', 'example-spec');

function temp() {
  return mkdtempSync(path.join(tmpdir(), 'hlou-spec-target-'));
}

function write(root, relative, data) {
  const file = path.join(root, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, data);
  return file;
}

function starter() {
  const root = temp();
  write(root, 'package.json', JSON.stringify({ scripts: { 'hlou:compile': 'node x' } }));
  write(
    root,
    SPEC_SITE_PATH,
    JSON.stringify({
      format: 1,
      project: { sourceLocale: 'fr' },
      locales: [{ code: 'fr' }, { code: 'it', enabled: false }],
    })
  );
  write(root, 'hlou/site/pages/home.json', '{}');
  write(root, 'hlou/site/pages/contact.json', '{}');
  return root;
}

describe('detectTarget', () => {
  it('is the bundle anywhere without hlou/site/site.json', () => {
    assert.equal(detectTarget(temp()).target, 'bundle');
  });

  it('is the spec in a starter, with its locales and pages', () => {
    const found = detectTarget(starter());
    assert.equal(found.target, 'spec');
    assert.equal(found.sourceLocale, 'fr');
    assert.deepEqual(found.locales, [
      { code: 'fr', enabled: true },
      { code: 'it', enabled: false },
    ]);
    assert.deepEqual(found.pages, ['contact', 'home']);
    assert.equal(found.hasCompile, true);
    assert.equal(found.problem, undefined);
  });

  it('stays the spec when site.json does not parse, and says why', () => {
    const root = temp();
    write(root, SPEC_SITE_PATH, '{ nope');
    const found = detectTarget(root);
    assert.equal(found.target, 'spec');
    assert.match(found.problem, /not JSON/);
  });
});

describe('placeMedia', () => {
  it('names files by the media path grammar', () => {
    assert.equal(mediaFileName('Hero Photo 1.PNG'), 'hero-photo-1.png');
    assert.equal(mediaFileName('Façade été.jpg'), 'facade-ete.jpg');
    assert.match('/media/x/' + mediaFileName('  .svg'), SPEC_MEDIA_PATH);
  });

  it('never replaces a file: same bytes reused, different bytes renamed', () => {
    const root = starter();
    const source = temp();
    const hero = write(source, 'hero.png', 'one');
    const other = write(source, 'other/hero.png', 'two');
    const first = placeMedia({ root, folder: 'Maison Exemple', files: [hero] });
    assert.deepEqual(
      first.map(({ src, status }) => ({ src, status })),
      [{ src: '/media/maison-exemple/hero.png', status: 'new' }]
    );
    const again = placeMedia({ root, folder: 'Maison Exemple', files: [hero, other] });
    assert.deepEqual(
      again.map(({ src, status }) => ({ src, status })),
      [
        { src: '/media/maison-exemple/hero.png', status: 'same' },
        { src: '/media/maison-exemple/hero-2.png', status: 'renamed' },
      ]
    );
    assert.equal(
      readFileSync(path.join(root, 'public/media/maison-exemple/hero.png'), 'utf8'),
      'one'
    );
    assert.equal(
      readFileSync(path.join(root, 'public/media/maison-exemple/hero-2.png'), 'utf8'),
      'two'
    );
  });

  it('writes nothing on a dry run', () => {
    const root = starter();
    const hero = write(temp(), 'hero.png', 'one');
    placeMedia({ root, folder: 'x', files: [hero], dryRun: true });
    assert.equal(existsSync(path.join(root, 'public/media')), false);
  });
});

/* -------------------------------------------------------------------------- */
/*                         Inside the Hlou repository                         */
/* -------------------------------------------------------------------------- */

const PATHS_TS = repoPath('packages', 'site-renderer', 'src', 'spec', 'paths.ts');
const SCHEMA_TS = repoPath('packages', 'site-renderer', 'src', 'spec', 'schema.ts');
const inRepo = Boolean(repoRoot && PATHS_TS && existsSync(PATHS_TS));

describe(
  'the spec format, as copied here',
  { skip: !inRepo && 'not inside the Hlou repository' },
  () => {
    it('matches the renderer’s paths.ts and schema.ts', () => {
      const paths = readFileSync(PATHS_TS, 'utf8');
      const schema = readFileSync(SCHEMA_TS, 'utf8');
      assert.ok(
        paths.includes(`SITE_SPEC_MEDIA_PATH = ${SPEC_MEDIA_PATH.source.replace(/^/, '/')}/;`)
      );
      assert.ok(paths.includes("SITE_SPEC_ROOT = 'hlou/site'"));
      assert.ok(paths.includes('SITE_SPEC_SITE_PATH = `${SITE_SPEC_ROOT}/site.json`'));
      assert.ok(paths.includes("SITE_SPEC_MEDIA_DIR = 'public/media'"));
      assert.ok(schema.includes(`SITE_SPEC_KEY = /${SPEC_KEY.source}/;`));
    });
  }
);

/** Every file under `dir`, by posix path relative to `root`. */
function walk(root, dir = root, out = {}) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(root, full, out);
    else out[path.relative(root, full).split(path.sep).join('/')] = readFileSync(full, 'utf8');
  }
  return out;
}

describe('the example spec', { skip: !inRepo && 'not inside the Hlou repository' }, () => {
  it('compiles, with the minimal fixture’s media placed by the script', async () => {
    const root = temp();
    for (const [file, text] of Object.entries(walk(EXAMPLE_SPEC))) write(root, file, text);
    const { map } = mediaMap({ bundle: path.join(CONTRACT_FIXTURES, 'minimal'), dir: root });
    assert.deepEqual(map, {
      logo: '/media/dar-minimal-fixture/logo.svg',
      hero: '/media/dar-minimal-fixture/hero.png',
      'display-font': '/media/dar-minimal-fixture/display.woff2',
    });

    const require = createRequire(path.join(repoRoot, 'packages', 'contracts', 'package.json'));
    const { tsImport } = await import(pathToFileURL(require.resolve('tsx/esm/api')).href);
    const spec = await tsImport(
      pathToFileURL(repoPath('packages', 'site-renderer', 'src', 'spec', 'index.ts')).href,
      import.meta.url
    );

    const files = walk(root);
    for (const media of Object.keys(files))
      if (media.startsWith('public/media/')) files[media] = true;
    const result = spec.compileSpecToSnapshot(files, { generatedAt: '2026-11-01T00:00:00.000Z' });
    assert.deepEqual(result.ok ? [] : result.errors, []);
    assert.deepEqual(result.snapshot.pages.map((page) => page.path).sort(), [
      '/',
      '/booking-1',
      '/booking-2',
    ]);
  });
});
