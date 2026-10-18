import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

import {
  HANDOFF_ASSET_EXTENSIONS,
  HANDOFF_KEY_PATTERN,
  HANDOFF_LIMITS,
  HANDOFF_PROBLEM_CODES,
  HANDOFF_SLUG_PATTERN,
  HEX_COLOR_PATTERN,
} from './lib/contract.mjs';
import { unknownKeywords } from './lib/json-schema.mjs';
import { repoPath, repoRoot } from './lib/testing.mjs';
import { expectedReferences, REFERENCE_DIR, SOURCES } from './refresh-references.mjs';

const repoOnly = repoRoot ? false : 'not inside the Hlou repository (published copy)';
const shipped = (file) => readFileSync(path.join(REFERENCE_DIR, file), 'utf8');

describe('reference files', () => {
  it('the shipped schema uses only keywords the validator knows', () => {
    assert.deepEqual(unknownKeywords(JSON.parse(shipped('handoff.schema.json'))), []);
  });

  it('the shipped schema equals the contract schema', { skip: repoOnly }, () => {
    const source = readFileSync(repoPath(SOURCES.schema), 'utf8');
    assert.deepEqual(JSON.parse(shipped('handoff.schema.json')), JSON.parse(source));
  });

  it(
    'every generated reference is current (node scripts/refresh-references.mjs)',
    { skip: repoOnly },
    () => {
      for (const [file, text] of Object.entries(expectedReferences(repoRoot))) {
        assert.equal(shipped(file), text, `reference/${file} is stale`);
      }
    }
  );

  it('the icon list holds Phosphor names, the font list Google families', () => {
    const icons = shipped('phosphor-icons.txt').trim().split('\n');
    assert.ok(icons.length >= 100 && icons.every((name) => /^[a-z0-9-]+$/.test(name)));
    const fonts = shipped('google-fonts.txt').trim().split('\n');
    assert.ok(fonts.length >= 1500 && fonts.includes('Inter'));
  });
});

describe('the contract port', () => {
  it('has the contract limits, extensions, codes and patterns', { skip: repoOnly }, () => {
    const source = readFileSync(repoPath(SOURCES.contract), 'utf8');
    const block = (name) => {
      const start = source.indexOf(`export const ${name}`);
      return source.slice(start, source.indexOf('as const;', start));
    };
    const limits = {};
    for (const [, key, expr] of block('HANDOFF_LIMITS').matchAll(/^\s+(\w+): ([\d\s*+]+),$/gm)) {
      limits[key] = Function(`return ${expr}`)();
    }
    assert.deepEqual(limits, HANDOFF_LIMITS);
    const extensions = {};
    for (const [, kind, list] of block('HANDOFF_ASSET_EXTENSIONS').matchAll(
      /^\s+(\w+): \[([^\]]*)\],$/gm
    )) {
      extensions[kind] = [...list.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    }
    assert.deepEqual(extensions, HANDOFF_ASSET_EXTENSIONS);
    const problemCodes = [...block('HANDOFF_PROBLEM_CODES').matchAll(/'(\w+)'/g)].map((m) => m[1]);
    assert.deepEqual(problemCodes, HANDOFF_PROBLEM_CODES);
    for (const [name, pattern] of Object.entries({
      HANDOFF_SLUG_PATTERN,
      HANDOFF_KEY_PATTERN,
      HEX_COLOR_PATTERN,
    })) {
      assert.ok(source.includes(`export const ${name} = ${pattern.toString()};`), name);
    }
  });
});
