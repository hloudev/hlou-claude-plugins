/*
 * The second target (Hlou decision 221): inside a Hlou starter — a folder with
 * `hlou/site/site.json` — the skill writes the site spec there instead of
 * packing a bundle. These helpers only find the target and place media; the
 * spec itself is checked by the starter's own `pnpm hlou:compile`.
 *
 * Names copied from the spec's format 1 (`renderer/spec/paths.ts` in the
 * starter); `spec-target.test.mjs` holds them equal when the Hlou repo is there.
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

/** The file that makes a folder a Hlou starter with a spec. */
export const SPEC_SITE_PATH = 'hlou/site/site.json';
/** Where a medium's bytes sit: `/media/<dir>/<file>` → `public/media/<dir>/<file>`. */
export const SPEC_MEDIA_DIR = 'public/media';
/** A medium as the spec names it: one folder level. */
export const SPEC_MEDIA_PATH = /^\/media\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;
/** A page slug, a component or record key. */
export const SPEC_KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * What `dir` is: `{ target: 'spec', root, sourceLocale, locales, pages }` in a
 * Hlou starter, `{ target: 'bundle' }` anywhere else. A `site.json` that does
 * not parse is still the spec target (`problem` says why): the skill fixes the
 * file, it does not fall back to a zip.
 */
export function detectTarget(dir) {
  const root = path.resolve(dir);
  const sitePath = path.join(root, SPEC_SITE_PATH);
  if (!existsSync(sitePath)) return { target: 'bundle', root };
  let site = null;
  let problem = null;
  try {
    site = JSON.parse(readFileSync(sitePath, 'utf8'));
  } catch (error) {
    problem = `${SPEC_SITE_PATH} is not JSON: ${error instanceof Error ? error.message : error}`;
  }
  const locales = Array.isArray(site?.locales)
    ? site.locales
        .filter((locale) => locale && typeof locale.code === 'string')
        .map((locale) => ({ code: locale.code, enabled: locale.enabled !== false }))
    : [];
  const pagesDir = path.join(root, 'hlou', 'site', 'pages');
  const pages = existsSync(pagesDir)
    ? listJson(pagesDir).map((name) => name.slice(0, -'.json'.length))
    : [];
  return {
    target: 'spec',
    root,
    sourceLocale:
      typeof site?.project?.sourceLocale === 'string' ? site.project.sourceLocale : null,
    locales,
    pages,
    hasCompile: hasCompileScript(root),
    ...(problem ? { problem } : {}),
  };
}

function listJson(dir) {
  try {
    return readdirSync(dir)
      .filter((name) => name.endsWith('.json'))
      .sort();
  } catch {
    return [];
  }
}

function hasCompileScript(root) {
  try {
    const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
    return typeof pkg?.scripts?.['hlou:compile'] === 'string';
  } catch {
    return false;
  }
}

/** `Hero Photo 1.PNG` → `hero-photo-1.png`: a name the media path grammar takes. */
export function mediaFileName(name) {
  const ext = path.extname(name).toLowerCase();
  const base = path
    .basename(name, path.extname(name))
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${base || 'asset'}${ext.replace(/[^a-z0-9.]/g, '')}`;
}

function sameBytes(a, b) {
  return readFileSync(a).equals(readFileSync(b));
}

/**
 * Copies a bundle's assets into `<root>/public/media/<folder>/` and returns
 * `[{ from, src, file, status }]`: `src` is the spec's path for it
 * (`/media/<folder>/<name>`). **Never replaces a file**: an existing file with
 * the same bytes is reused (`status: 'same'`), a different one gets the next
 * free name (`hero-2.png`, `status: 'renamed'`). Media already in Hlou keeps
 * its versions there; the spec only ever adds.
 */
export function placeMedia({ root, folder, files, dryRun = false }) {
  const dirName = mediaFileName(folder).replace(/\./g, '-');
  const targetDir = path.join(root, SPEC_MEDIA_DIR, dirName);
  const taken = new Set();
  const placed = [];
  for (const from of files) {
    const name = mediaFileName(path.basename(from));
    const ext = path.extname(name);
    const stem = name.slice(0, name.length - ext.length);
    let candidate = name;
    let status = 'new';
    for (let n = 2; ; n += 1) {
      const target = path.join(targetDir, candidate);
      if (taken.has(candidate)) {
        candidate = `${stem}-${n}${ext}`;
        status = 'renamed';
        continue;
      }
      if (!existsSync(target)) break;
      if (sameBytes(from, target)) {
        status = 'same';
        break;
      }
      candidate = `${stem}-${n}${ext}`;
      status = 'renamed';
    }
    taken.add(candidate);
    const src = `/media/${dirName}/${candidate}`;
    if (!SPEC_MEDIA_PATH.test(src)) throw new Error(`Not a spec media path: ${src}`);
    const file = path.join(targetDir, candidate);
    if (!dryRun && status !== 'same') {
      mkdirSync(targetDir, { recursive: true });
      copyFileSync(from, file);
    }
    placed.push({ from, src, file: path.relative(root, file).split(path.sep).join('/'), status });
  }
  return placed;
}
