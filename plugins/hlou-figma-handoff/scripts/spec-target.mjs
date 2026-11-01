#!/usr/bin/env node
/*
 * node spec-target.mjs detect [dir]
 *   Prints, as JSON, where this run writes: `{ "target": "spec", sourceLocale,
 *   locales, pages, hasCompile }` inside a Hlou starter (a folder with
 *   hlou/site/site.json), `{ "target": "bundle" }` anywhere else.
 *
 * node spec-target.mjs media <bundle-dir> [dir] [--folder <name>] [--dry-run]
 *   Copies every asset the bundle's manifest lists into
 *   <dir>/public/media/<name>/ (default name: the bundle's file name as a
 *   slug) and prints `{ "<ref>": "/media/<name>/<file>" }`: the paths the spec
 *   names them by. Never replaces an existing file: the same bytes are reused,
 *   different bytes get a new name.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { HANDOFF_MANIFEST_PATH } from './lib/contract.mjs';
import { detectTarget, mediaFileName, placeMedia } from './lib/spec-target.mjs';

function usage() {
  console.error(
    'usage: spec-target.mjs detect [dir]\n' +
      '       spec-target.mjs media <bundle-dir> [dir] [--folder <name>] [--dry-run]'
  );
  process.exit(2);
}

export function mediaMap({ bundle, dir, folder, dryRun }) {
  const manifest = JSON.parse(readFileSync(path.join(bundle, HANDOFF_MANIFEST_PATH), 'utf8'));
  const assets = Array.isArray(manifest.assets) ? manifest.assets : [];
  const name =
    folder ?? mediaFileName(String(manifest.source?.fileName ?? 'figma')).replace(/\./g, '-');
  const placed = placeMedia({
    root: path.resolve(dir),
    folder: name,
    files: assets.map((asset) => path.join(bundle, asset.path)),
    dryRun,
  });
  const map = {};
  assets.forEach((asset, index) => {
    map[asset.ref] = placed[index].src;
  });
  return { map, placed };
}

function main(argv) {
  const [command, ...rest] = argv;
  if (command === 'detect') {
    console.log(JSON.stringify(detectTarget(rest[0] ?? '.'), null, 2));
    return;
  }
  if (command === 'media') {
    const positional = [];
    let folder;
    let dryRun = false;
    for (let i = 0; i < rest.length; i += 1) {
      if (rest[i] === '--folder') folder = rest[++i];
      else if (rest[i] === '--dry-run') dryRun = true;
      else positional.push(rest[i]);
    }
    const [bundle, dir = '.'] = positional;
    if (!bundle) usage();
    if (detectTarget(dir).target !== 'spec') {
      console.error(`${path.resolve(dir)} is not a Hlou starter (no hlou/site/site.json)`);
      process.exit(1);
    }
    const { map, placed } = mediaMap({ bundle, dir, folder, dryRun });
    for (const entry of placed) {
      if (entry.status !== 'new') console.error(`${entry.status}: ${entry.file}`);
    }
    console.log(JSON.stringify(map, null, 2));
    return;
  }
  usage();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
