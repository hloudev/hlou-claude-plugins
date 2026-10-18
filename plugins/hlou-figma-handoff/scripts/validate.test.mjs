import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { HANDOFF_PROBLEM_CODES } from './lib/contract.mjs';
import { CONTRACT_FIXTURES, makeBundle, png } from './lib/testing.mjs';
import { writeZip } from './lib/zip.mjs';
import { checkManifest, SCHEMA_PATH, validateBundle } from './validate.mjs';

const here = path.dirname(new URL(import.meta.url).pathname);
const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
const invalidDir = CONTRACT_FIXTURES && path.join(CONTRACT_FIXTURES, 'invalid');
const minimalDir = CONTRACT_FIXTURES && path.join(CONTRACT_FIXTURES, 'minimal');
const inRepo = Boolean(invalidDir && existsSync(invalidDir));
const repoOnly = inRepo ? false : 'the contract fixtures are not here (published copy)';

const codes = (problems) => problems.map((problem) => problem.code);

describe('the manifest', () => {
  it('accepts the shipped example manifest', () => {
    const example = JSON.parse(
      readFileSync(path.join(here, '..', 'reference', 'example-manifest.json'), 'utf8')
    );
    assert.deepEqual(checkManifest(example, schema), []);
  });

  it('refuses each invalid fixture with its code', { skip: repoOnly }, () => {
    const names = readdirSync(invalidDir).filter((name) => name.endsWith('.json'));
    assert.ok(names.length >= 20);
    const seen = new Set();
    for (const name of names) {
      const { manifest, expect } = JSON.parse(readFileSync(path.join(invalidDir, name), 'utf8'));
      const issues = checkManifest(manifest, schema);
      seen.add(expect.code);
      assert.ok(codes(issues).includes(expect.code), `${name}: ${JSON.stringify(issues)}`);
      if (expect.path) {
        assert.ok(
          issues.some((issue) => JSON.stringify(issue.path) === JSON.stringify(expect.path)),
          `${name}: no issue at ${expect.path.join('.')} in ${JSON.stringify(issues)}`
        );
      }
    }
    for (const code of HANDOFF_PROBLEM_CODES) assert.ok(seen.has(code), code);
  });
});

describe('validateBundle', () => {
  it('passes the contract minimal bundle', { skip: repoOnly }, () => {
    assert.deepEqual(validateBundle(minimalDir), []);
  });

  it('passes the example bundle, as a folder and as a zip', () => {
    const dir = makeBundle();
    assert.deepEqual(validateBundle(dir), []);
    const names = [
      'hlou-handoff.json',
      'assets/hero.png',
      'assets/logo.svg',
      'pages/home.html',
      'renders/home.png',
    ];
    const zip = path.join(dir, 'out.zip');
    writeFileSync(
      zip,
      writeZip(names.map((name) => ({ name, data: readFileSync(path.join(dir, name)) })))
    );
    assert.deepEqual(validateBundle(zip), []);
  });

  it('ignores notes and work files beside the bundle', () => {
    const dir = makeBundle((_, files) => {
      files['NOTES.md'] = '# Notes';
      files['metadata.xml'] = '<canvas/>';
    });
    assert.deepEqual(validateBundle(dir), []);
  });

  it('fails on a schema keyword it does not know', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'hlou-schema-'));
    const future = {
      ...schema,
      properties: { ...schema.properties, hlou: { ...schema.properties.hlou, multipleOf: 1 } },
    };
    writeFileSync(path.join(dir, 'schema.json'), JSON.stringify(future));
    const problems = validateBundle(makeBundle(), { schemaPath: path.join(dir, 'schema.json') });
    assert.deepEqual(codes(problems), ['schemaKeyword']);
    assert.match(problems[0].path, /multipleOf/);
  });

  it('fails on a missing file', () => {
    const dir = makeBundle((_, files) => {
      files['assets/hero.png'] = null;
    });
    assert.deepEqual(codes(validateBundle(dir)), ['fileMissing', 'pageAssetMissing']);
  });

  it('fails on a ../ path', () => {
    const dir = makeBundle((manifest) => {
      manifest.assets[1].path = 'assets/../hero.png';
    });
    assert.ok(codes(validateBundle(dir)).includes('assetPathOutside'));
    const zip = path.join(dir, 'evil.zip');
    writeFileSync(zip, writeZip([{ name: '../evil.txt', data: Buffer.from('x') }]));
    assert.deepEqual(codes(validateBundle(zip)), ['badPath', 'manifestMissing']);
  });

  it('fails on an oversize render or image, and on a mislabelled image', () => {
    const big = makeBundle((_, files) => {
      files['renders/home.png'] = png(1000, 2400);
      files['assets/hero.png'] = png(3000, 2000);
    });
    assert.deepEqual(codes(validateBundle(big)), ['renderTooLarge', 'imageTooLarge']);
    const fake = makeBundle((_, files) => {
      files['assets/hero.png'] = 'not a png';
    });
    assert.deepEqual(codes(validateBundle(fake)), ['imageFormat']);
  });

  it('fails on an unlisted file, a script, a remote font and a section left unmarked', () => {
    const dir = makeBundle((manifest, files) => {
      files['assets/stray.svg'] = '<svg/>';
      files['pages/home.html'] = files['pages/home.html']
        .replace('</body>', '<script>alert(1)</script></body>')
        .replace('<style>', '<link rel="stylesheet" href="https://fonts.example.com/css" /><style>')
        .replace('data-hl-section="hero"', 'data-hl-section="banner"');
    });
    assert.deepEqual(codes(validateBundle(dir)).sort(), [
      'fileUnlisted',
      'pageRemote',
      'pageScript',
      'sectionMissing',
    ]);
  });

  it('reports schema issues with their path and stops there', () => {
    const dir = makeBundle((manifest) => {
      manifest.pages[0].slug = 'Home';
    });
    const problems = validateBundle(dir);
    assert.deepEqual(
      problems.map((p) => [p.code, p.path]),
      [['schema', 'pages.0.slug']]
    );
  });
});
