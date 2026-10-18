#!/usr/bin/env node
/*
 * node pack.mjs <bundle-dir> <out.zip>
 *
 * Validates the bundle, then zips it deterministically: the manifest first,
 * the other files sorted, PNG/JPEG/WebP/WOFF2 stored and the rest deflated,
 * every timestamp the zip epoch. The same folder gives the same bytes.
 * Only the manifest and pages/, assets/, renders/ go in; notes and work files
 * beside them stay out.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { HANDOFF_LIMITS, HANDOFF_MANIFEST_PATH } from './lib/contract.mjs';
import { writeZip } from './lib/zip.mjs';
import { loadBundle, validateBundle } from './validate.mjs';

/** A bundle folder → the zip's bytes; throws with the problems when it does not validate. */
export function packBundle(dir) {
  const problems = validateBundle(dir);
  if (problems.length > 0) {
    const lines = problems.map((problem) => `${problem.code} ${problem.path} ${problem.message}`);
    throw new Error(`The bundle does not validate:\n${lines.join('\n')}`);
  }
  const { files } = loadBundle(dir);
  if (files.size > HANDOFF_LIMITS.entries) {
    throw new Error(`${files.size} files, over ${HANDOFF_LIMITS.entries}`);
  }
  const names = [...files.keys()]
    .filter((name) => name !== HANDOFF_MANIFEST_PATH)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const zip = writeZip(
    [HANDOFF_MANIFEST_PATH, ...names].map((name) => ({ name, data: files.get(name).read() }))
  );
  if (zip.length > HANDOFF_LIMITS.zippedBytes) {
    throw new Error(`The zip is ${zip.length} bytes, over ${HANDOFF_LIMITS.zippedBytes}`);
  }
  return zip;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [dir, out] = process.argv.slice(2);
  if (!dir || !out) {
    console.error('Usage: node pack.mjs <bundle-dir> <out.zip>');
    process.exit(2);
  }
  try {
    const zip = packBundle(path.resolve(dir));
    writeFileSync(path.resolve(out), zip);
    console.log(`${path.resolve(out)} (${zip.length} bytes)`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
