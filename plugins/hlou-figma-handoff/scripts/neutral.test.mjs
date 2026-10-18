/*
 * The plugin is published: it carries no client data. Every name, file key
 * and node id of the eval bundles this skill produced must stay out of it.
 * The deny-list is read from those bundles, so this test names nothing.
 */

import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

import { EVAL_BUNDLES } from './lib/testing.mjs';

const pluginRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

/** Words of four letters or more that name nothing (English and French). */
const COMMON = new Set(
  `about after again also avec back best blog book booking camp card case chez client clients concept
  contact copy dans dark design desktop draft dune edit file files final first fixture full gallery hero
  home hotel house landing light live main maison maquette menu minimal mobile more new news nouveau
  page pages plan pour project projet proto prototype refonte remake site sites staging story studio
  style template test theme this tour travel ui ux version website with work`.split(/\s+/)
);

function bundlesUnder(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .filter(
      (entry) => entry.isDirectory() && existsSync(path.join(dir, entry.name, 'hlou-handoff.json'))
    )
    .map((entry) => ({
      folder: entry.name,
      manifest: JSON.parse(readFileSync(path.join(dir, entry.name, 'hlou-handoff.json'), 'utf8')),
    }));
}

function nodeIds(value, found = new Set()) {
  if (Array.isArray(value)) value.forEach((item) => nodeIds(item, found));
  else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if ((key === 'frameId' || key === 'nodeId') && typeof item === 'string') found.add(item);
      else nodeIds(item, found);
    }
  }
  return found;
}

/** `{ words, ids }`: substrings, and node ids matched as whole tokens. */
export function denyList(bundles) {
  const words = new Set();
  const ids = new Set();
  for (const { folder, manifest } of bundles) {
    words.add(folder.toLowerCase());
    const { fileKey, fileName } = manifest.source ?? {};
    if (fileKey) words.add(fileKey.toLowerCase());
    if (fileName) {
      words.add(fileName.toLowerCase());
      for (const word of fileName.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
        if ([...word].length >= 4 && !COMMON.has(word)) words.add(word);
      }
    }
    for (const id of nodeIds(manifest)) if (id.length >= 5) ids.add(id);
  }
  return { words: [...words], ids: [...ids] };
}

function pluginFiles(dir = pluginRoot) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '_work' && entry.name !== 'node_modules' && entry.name !== '.git')
        files.push(...pluginFiles(absolute));
    } else if (!entry.name.endsWith('.zip')) files.push(absolute);
  }
  return files;
}

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const bundles = EVAL_BUNDLES && existsSync(EVAL_BUNDLES) ? bundlesUnder(EVAL_BUNDLES) : [];

describe('the plugin is brand-neutral', () => {
  it(
    'names no file, brand or node of the eval bundles',
    {
      skip: bundles.length
        ? false
        : 'no eval bundle here (published copy): nothing to compare against',
    },
    () => {
      const { words, ids } = denyList(bundles);
      assert.ok(words.length > 0);
      const idPattern = ids.length
        ? new RegExp(`(?<![\\w:;])(?:${ids.map(escape).join('|')})(?![\\w:])`)
        : null;
      const hits = [];
      for (const file of pluginFiles()) {
        const text = readFileSync(file, 'utf8');
        const lower = text.toLowerCase();
        const relative = path.relative(pluginRoot, file);
        for (const word of words)
          if (lower.includes(word)) hits.push(`${relative}: a name from the eval bundles`);
        const id = idPattern?.exec(text);
        if (id) hits.push(`${relative}: node id ${id[0]}`);
      }
      assert.deepEqual(hits, []);
    }
  );

  it('builds its deny-list from the bundles alone', () => {
    const { words, ids } = denyList([
      {
        folder: 'maison-exemple',
        manifest: {
          source: { fileKey: 'abcDEF123', fileName: 'Maison Exemple — Refonte site' },
          pages: [{ frameId: '12:345', sections: [{ nodeId: '1:2' }] }],
        },
      },
    ]);
    assert.deepEqual(words.sort(), [
      'abcdef123',
      'exemple',
      'maison exemple — refonte site',
      'maison-exemple',
    ]);
    assert.deepEqual(ids, ['12:345']);
  });
});
