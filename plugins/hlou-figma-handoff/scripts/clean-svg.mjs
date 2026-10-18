#!/usr/bin/env node
/*
 * node clean-svg.mjs <file.svg>...
 *
 * An SVG export of a node inside a frame can come with its ancestors'
 * backgrounds drawn first — the canvas colour and the page frame as `<rect>`s
 * at least as large as the export — so a white logo lands on a coloured box.
 * This removes those wrapper rects, in place: a `<rect>` outside `<defs>`,
 * drawn before anything else, that covers the whole viewport. Prints what it
 * removed per file.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DRAWING = new Set([
  'path',
  'circle',
  'ellipse',
  'line',
  'polygon',
  'polyline',
  'image',
  'text',
  'use',
]);
const HIDDEN = new Set([
  'defs',
  'clipPath',
  'mask',
  'pattern',
  'linearGradient',
  'radialGradient',
  'filter',
  'symbol',
]);

function attribute(tag, name) {
  const match = new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`).exec(tag);
  return match ? match[1] : undefined;
}

/** The SVG text without its leading background rects, and how many were removed. */
export function cleanSvg(text) {
  const root = /<svg\b[^>]*>/.exec(text);
  if (!root) return { text, removed: 0 };
  const viewBox = attribute(root[0], 'viewBox')
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  const width = Number(attribute(root[0], 'width') ?? viewBox?.[2]);
  const height = Number(attribute(root[0], 'height') ?? viewBox?.[3]);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return { text, removed: 0 };

  const cuts = [];
  let hiddenDepth = 0;
  const tags = /<(\/?)([a-zA-Z][\w:-]*)\b[^>]*?(\/?)>/g;
  tags.lastIndex = root.index + root[0].length;
  for (let m = tags.exec(text); m; m = tags.exec(text)) {
    const [tag, closing, name, selfClosing] = m;
    if (HIDDEN.has(name)) {
      if (closing) hiddenDepth = Math.max(0, hiddenDepth - 1);
      else if (!selfClosing) hiddenDepth++;
      continue;
    }
    if (hiddenDepth > 0 || closing) continue;
    if (DRAWING.has(name)) break;
    if (name === 'rect') {
      const covers =
        Number(attribute(tag, 'width')) >= width && Number(attribute(tag, 'height')) >= height;
      if (!covers) break;
      cuts.push([m.index, m.index + tag.length]);
    }
  }
  let out = text;
  for (const [start, end] of cuts.reverse()) {
    const lineEnd = out[end] === '\n' ? end + 1 : end;
    out = out.slice(0, start) + out.slice(lineEnd);
  }
  return { text: out, removed: cuts.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error('Usage: node clean-svg.mjs <file.svg>...');
    process.exit(2);
  }
  for (const file of files) {
    const { text, removed } = cleanSvg(readFileSync(file, 'utf8'));
    if (removed > 0) writeFileSync(file, text);
    console.log(`${file}: ${removed} background rect${removed === 1 ? '' : 's'} removed`);
  }
}
