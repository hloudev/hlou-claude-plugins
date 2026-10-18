#!/usr/bin/env node
/*
 * node validate.mjs <bundle-dir | bundle.zip>
 *
 * Checks a Hlou handoff bundle: the manifest against reference/handoff.schema.json,
 * the cross-references, then the files (present, inside the layout, the right
 * format, within the edge and size limits) and the pages (no script, nothing
 * fetched from the network, every asset they use present).
 * Prints one `code path message` line per problem; exit 1 on any.
 */
import { lstatSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  extensionOf,
  HANDOFF_DIRS,
  HANDOFF_LIMITS,
  HANDOFF_MANIFEST_PATH,
  handoffProblems,
  isHandoffPath,
  withDefaults,
} from './lib/contract.mjs';
import { imageSize } from './lib/images.mjs';
import { unknownKeywords, validateJson } from './lib/json-schema.mjs';
import { readZip } from './lib/zip.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SCHEMA_PATH = path.join(here, '..', 'reference', 'handoff.schema.json');

const L = HANDOFF_LIMITS;
const LAYOUT_DIRS = Object.values(HANDOFF_DIRS);

/** A file that belongs to the bundle: the manifest, or anything under a layout dir. */
function inLayout(relative) {
  return relative === HANDOFF_MANIFEST_PATH || LAYOUT_DIRS.some((dir) => relative.startsWith(dir));
}

/** Dotfiles (`.DS_Store`) are skipped in a folder and by pack.mjs. */
function isDotfile(relative) {
  return relative.split('/').some((segment) => segment.startsWith('.'));
}

/**
 * A folder or a zip → `{ files: Map<path, { size, read() }>, problems }`. In a
 * folder, only the manifest and the layout dirs count (notes and work files
 * beside them are ignored); in a zip, every entry must be in the layout.
 */
export function loadBundle(input) {
  const files = new Map();
  const problems = [];
  const add = (code, at, message) => problems.push({ code, path: at, message });

  if (statSync(input).isDirectory()) {
    const walk = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const absolute = path.join(dir, entry.name);
        const relative = path.relative(input, absolute).split(path.sep).join('/');
        if (isDotfile(relative)) continue;
        if (entry.isDirectory()) {
          if (LAYOUT_DIRS.some((d) => d.startsWith(`${relative}/`) || relative.startsWith(d))) {
            walk(absolute);
          }
          continue;
        }
        if (!inLayout(relative)) continue;
        if (lstatSync(absolute).isSymbolicLink()) {
          add('symlink', relative, 'A bundle holds no symbolic link');
          continue;
        }
        if (!isHandoffPath(relative)) {
          add(
            'badPath',
            relative,
            `Not a valid bundle path (≤ ${L.pathLength} characters, no ./..)`
          );
          continue;
        }
        const size = statSync(absolute).size;
        files.set(relative, { size, read: () => readFileSync(absolute) });
      }
    };
    walk(input);
    return { files, problems };
  }

  const buffer = readFileSync(input);
  if (buffer.length > L.zippedBytes) {
    add('tooLarge', '-', `The zip is ${buffer.length} bytes, over ${L.zippedBytes}`);
  }
  let entries;
  try {
    ({ entries } = readZip(buffer));
  } catch (error) {
    add('zip', '-', error instanceof Error ? error.message : 'Not a zip');
    return { files, problems };
  }
  const real = entries.filter((entry) => !entry.name.endsWith('/'));
  if (real.length > L.entries)
    add('tooManyEntries', '-', `${real.length} entries, over ${L.entries}`);
  const inflated = real.reduce((sum, entry) => sum + entry.size, 0);
  if (inflated > L.inflatedBytes) {
    add('tooLarge', '-', `${inflated} bytes once unzipped, over ${L.inflatedBytes}`);
  }
  for (const entry of real) {
    if (entry.symlink) add('symlink', entry.name, 'A bundle holds no symbolic link');
    else if (!isHandoffPath(entry.name)) add('badPath', entry.name, 'Not a valid bundle path');
    else files.set(entry.name, { size: entry.size, read: () => entry.read() });
  }
  return { files, problems };
}

function at(issuePath) {
  return issuePath.length === 0 ? '-' : issuePath.join('.');
}

const REMOTE = [
  /\b(?:src|srcset|poster|data)\s*=\s*["']?\s*(?:https?:)?\/\//i,
  /<link\b[^>]*\bhref\s*=\s*["']?\s*(?:https?:)?\/\//i,
  /@import\b/i,
  /url\(\s*["']?\s*(?:https?:)?\/\//i,
];

const LOCAL_REF =
  /(?:\b(?:src|href|poster)\s*=\s*["']([^"']+)["'])|(?:url\(\s*["']?([^"')]+)["']?\s*\))/gi;

/** The bundle files a page uses: `../assets/logo.svg` → `assets/logo.svg`. */
function pageRefs(html) {
  const refs = new Set();
  for (const match of html.matchAll(LOCAL_REF)) {
    const ref = (match[1] ?? match[2] ?? '').trim().split(/[?#]/)[0];
    if (!ref || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(ref)) continue;
    const resolved = path.posix.normalize(path.posix.join('pages', ref));
    if (/\.(?:png|jpe?g|webp|svg|woff2|ttf|otf|gif)$/i.test(resolved)) refs.add(resolved);
  }
  return refs;
}

/**
 * A parsed manifest → its schema issues (`code: 'schema'`, path an array) or,
 * when the schema accepts it, its cross-reference problems. No file is read.
 */
export function checkManifest(manifest, schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'))) {
  const issues = validateJson(schema, manifest);
  return issues.length > 0 ? issues : handoffProblems(manifest);
}

/**
 * Every problem of the bundle at `input` (a folder or a zip), as
 * `{ code, path, message }` with `path` a dotted manifest path or a file path.
 */
export function validateBundle(input, { schemaPath = SCHEMA_PATH } = {}) {
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
  const unknown = unknownKeywords(schema);
  if (unknown.length > 0) {
    return unknown.map((issue) => ({ ...issue, path: `schema:${at(issue.path)}` }));
  }

  const { files, problems } = loadBundle(input);
  const add = (code, where, message) => problems.push({ code, path: where, message });

  const manifestFile = files.get(HANDOFF_MANIFEST_PATH);
  if (!manifestFile) {
    add('manifestMissing', HANDOFF_MANIFEST_PATH, 'The bundle has no manifest');
    return problems;
  }
  if (manifestFile.size > L.manifestBytes) {
    add('manifestTooLarge', HANDOFF_MANIFEST_PATH, `Over ${L.manifestBytes} bytes`);
    return problems;
  }
  let manifest;
  try {
    manifest = JSON.parse(manifestFile.read().toString('utf8'));
  } catch (error) {
    add('json', HANDOFF_MANIFEST_PATH, error instanceof Error ? error.message : 'Not JSON');
    return problems;
  }
  const manifestIssues = checkManifest(manifest, schema);
  for (const issue of manifestIssues) add(issue.code, at(issue.path), issue.message);
  if (manifestIssues.some((issue) => issue.code === 'schema')) return problems;

  const m = withDefaults(manifest);
  const named = new Map();
  const name = (file, where) => {
    if (!named.has(file)) named.set(file, where);
  };
  m.pages.forEach((page, i) => {
    name(page.html, `pages.${i}.html`);
    if (page.render !== undefined) name(page.render, `pages.${i}.render`);
  });
  m.assets.forEach((asset, i) => name(asset.path, `assets.${i}.path`));
  m.tokens.fonts.forEach((font, i) =>
    (font.files ?? []).forEach((file, j) => name(file, `tokens.fonts.${i}.files.${j}`))
  );

  for (const [file, where] of named) {
    if (isHandoffPath(file) && !files.has(file))
      add('fileMissing', where, `« ${file} » is not in the bundle`);
  }
  for (const file of files.keys()) {
    if (file !== HANDOFF_MANIFEST_PATH && !named.has(file)) {
      add('fileUnlisted', file, 'In the bundle but named nowhere in the manifest');
    }
  }

  /* Renders: PNG, ≤ renderMaxEdge. */
  m.pages.forEach((page, i) => {
    const file = page.render !== undefined ? files.get(page.render) : undefined;
    if (!file) return;
    const size = imageSize(file.read());
    if (!size || size.format !== 'png') {
      add('renderFormat', `pages.${i}.render`, `« ${page.render} » is not a PNG`);
    } else if (Math.max(size.width, size.height) > L.renderMaxEdge) {
      add(
        'renderTooLarge',
        `pages.${i}.render`,
        `${size.width}×${size.height}, over ${L.renderMaxEdge} px on the long edge`
      );
    }
  });

  /* Raster assets: what the extension says, ≤ imageMaxEdge. */
  m.assets.forEach((asset, i) => {
    const file = files.get(asset.path);
    if (!file || asset.kind !== 'image') return;
    const size = imageSize(file.read());
    const ext = extensionOf(asset.path);
    const expected = ext === 'jpg' ? 'jpeg' : ext;
    if (!size || size.format !== expected) {
      add(
        'imageFormat',
        `assets.${i}.path`,
        `« ${asset.path} » is not a ${ext.toUpperCase()} file`
      );
    } else if (Math.max(size.width, size.height) > L.imageMaxEdge) {
      add(
        'imageTooLarge',
        `assets.${i}.path`,
        `${size.width}×${size.height}, over ${L.imageMaxEdge} px on the long edge`
      );
    }
  });

  /* Pages: drawn with scripts off and the network cut. */
  m.pages.forEach((page, i) => {
    const file = files.get(page.html);
    if (!file) return;
    const html = file.read().toString('utf8');
    if (/<script\b/i.test(html)) add('pageScript', `pages.${i}.html`, 'A page holds no <script>');
    if (REMOTE.some((pattern) => pattern.test(html))) {
      add(
        'pageRemote',
        `pages.${i}.html`,
        'A page loads nothing from the network (CDN, web font, remote image)'
      );
    }
    for (const ref of pageRefs(html)) {
      if (!files.has(ref))
        add('pageAssetMissing', `pages.${i}.html`, `Uses « ${ref} », not in the bundle`);
    }
    if (/\bdata-hl-section\s*=/.test(html)) {
      page.sections.forEach((section, j) => {
        const marker = new RegExp(
          `data-hl-section\\s*=\\s*["']${section.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`
        );
        if (!marker.test(html)) {
          add(
            'sectionMissing',
            `pages.${i}.sections.${j}.id`,
            `No data-hl-section="${section.id}" in ${page.html}`
          );
        }
      });
    }
  });

  if (files.size > L.entries) add('tooManyEntries', '-', `${files.size} files, over ${L.entries}`);
  const total = [...files.values()].reduce((sum, file) => sum + file.size, 0);
  if (total > L.inflatedBytes) add('tooLarge', '-', `${total} bytes, over ${L.inflatedBytes}`);

  return problems;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const input = process.argv[2];
  if (!input) {
    console.error('Usage: node validate.mjs <bundle-dir | bundle.zip>');
    process.exit(2);
  }
  const problems = validateBundle(path.resolve(input));
  for (const problem of problems) console.log(`${problem.code} ${problem.path} ${problem.message}`);
  process.exit(problems.length > 0 ? 1 : 0);
}
