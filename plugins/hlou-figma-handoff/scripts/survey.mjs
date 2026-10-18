#!/usr/bin/env node
/*
 * node survey.mjs <metadata.xml | saved get_metadata result> [out.json]
 *
 * Reads the XML the Figma MCP's `get_metadata` returns for a page and writes
 * a compact survey (default: survey.json beside the input) for classifying
 * the page before anything else is read:
 *
 * - top-level frames (id, name, size, markers), with their header signature
 *   (text layers in the top 200 px), step text (« STEP 2 OF 4 »), vertical
 *   bands of direct children (candidate sections), hidden same-size siblings
 *   that overlap (slides or states), vector-only groups (one SVG each; icons
 *   of ≤ 64 px listed apart as `id W×H`), repeated cards (collection
 *   candidates) and marked layers;
 * - frames sharing a name, layers outside any frame, flow and overlay candidates.
 *
 * `get_metadata` leaves vector nodes out: a frame with no child is usually an
 * icon whose vectors were omitted, and counts as vector art here.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseFigmaMarkers } from './lib/markers.mjs';

/* -------------------------------------------------------------------------- */
/*                                  Tokenizer                                 */
/* -------------------------------------------------------------------------- */

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decode(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body) => {
    if (body[0] === '#') {
      const code =
        body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : Number(body.slice(1));
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[body.toLowerCase()] ?? whole;
  });
}

const TAG =
  /<(\/?)([a-zA-Z][\w:-]*)((?:\s+[\w:-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>/g;
const ATTR = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

const NUMERIC = new Set(['x', 'y', 'width', 'height']);

/**
 * XML text → the root nodes, each `{ type, id, name, x, y, width, height,
 * hidden, children }` (`type` is the tag). Text between tags is ignored.
 * Lenient: an unbalanced close is skipped.
 */
export function parseMetadataXml(text) {
  const roots = [];
  const stack = [];
  for (const match of text.matchAll(TAG)) {
    const [, closing, tag, attrs, selfClosing] = match;
    if (tag === undefined) continue; // comment, declaration, CDATA
    if (closing) {
      const index = stack.map((node) => node.type).lastIndexOf(tag);
      if (index >= 0) stack.length = index;
      continue;
    }
    const node = {
      type: tag,
      id: null,
      name: '',
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      hidden: false,
      children: [],
    };
    for (const [, key, double, single] of attrs.matchAll(ATTR)) {
      const value = decode(double ?? single ?? '');
      if (NUMERIC.has(key)) node[key] = Number(value) || 0;
      else if (key === 'hidden') node.hidden = value === 'true';
      else if (key === 'id' || key === 'name') node[key] = value;
    }
    const parent = stack.at(-1);
    if (parent) parent.children.push(node);
    else roots.push(node);
    if (!selfClosing) stack.push(node);
  }
  return roots;
}

/** The XML inside a saved MCP tool result (`[{ type, text }]`), or the text itself. */
export function metadataText(raw) {
  const trimmed = raw.trimStart();
  if (!trimmed.startsWith('[')) return raw;
  try {
    const parts = JSON.parse(trimmed);
    const xml = parts.find(
      (part) => typeof part?.text === 'string' && part.text.trimStart().startsWith('<')
    );
    return xml ? xml.text : raw;
  } catch {
    return raw;
  }
}

/* -------------------------------------------------------------------------- */
/*                                  Geometry                                  */
/* -------------------------------------------------------------------------- */

const CONTAINERS = new Set([
  'frame',
  'group',
  'component',
  'instance',
  'component-set',
  'section',
  'canvas',
]);
const VECTOR_LEAVES = new Set([
  'vector',
  'boolean-operation',
  'star',
  'ellipse',
  'line',
  'regular-polygon',
  'polygon',
]);
const TOLERANCE = 2;

const round = (n) => Math.round(n * 100) / 100;

/**
 * Whether `node`'s children sit in its parent's coordinate space (a Figma
 * group) rather than its own (a frame): every child fits the node's box as
 * placed in the parent, and not all of them fit at the origin.
 */
function childrenInParentSpace(node) {
  if (node.children.length === 0 || (Math.abs(node.x) < 1 && Math.abs(node.y) < 1)) return false;
  const fits = (child, ox, oy) =>
    child.x >= ox - 1 &&
    child.y >= oy - 1 &&
    child.x + child.width <= ox + node.width + 1 &&
    child.y + child.height <= oy + node.height + 1;
  return (
    node.children.every((c) => fits(c, node.x, node.y)) &&
    !node.children.every((c) => fits(c, 0, 0))
  );
}

/** Walks `frame`'s subtree with each node's top-left relative to the frame. */
function walk(frame, visit) {
  const go = (node, ox, oy, depth, parent) => {
    const ax = ox + node.x;
    const ay = oy + node.y;
    visit(node, ax, ay, depth, parent);
    const [cx, cy] = childrenInParentSpace(node) ? [ox, oy] : [ax, ay];
    for (const child of node.children) go(child, cx, cy, depth + 1, node);
  };
  for (const child of frame.children) go(child, 0, 0, 1, frame);
}

/** A container whose leaves are all vector art (or omitted vectors), with at least one leaf. */
function isVectorOnly(node) {
  if (node.type === 'text' || node.type === 'rounded-rectangle' || node.type === 'rectangle')
    return false;
  if (node.children.length === 0) return CONTAINERS.has(node.type) || VECTOR_LEAVES.has(node.type);
  return node.children.every(isVectorOnly);
}

/**
 * Vector art drawn as one picture (a logo, an illustration), not a row of
 * separate icons: vector-only, and its children cover at least a quarter of
 * its box (two arrows 1700 px apart are two icons, not one graphic).
 */
function isVectorArt(node) {
  if (!CONTAINERS.has(node.type) || !isVectorOnly(node)) return false;
  if (node.children.length < 2) return true;
  const covered = node.children.reduce((sum, child) => sum + child.width * child.height, 0);
  return covered >= node.width * node.height * 0.25;
}

/** Whether two boxes (in the same parent) overlap. */
function overlap(a, b) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

function countLeaves(node) {
  return node.children.length === 0
    ? 1
    : node.children.reduce((sum, child) => sum + countLeaves(child), 0);
}

const short = (text, max = 80) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/* -------------------------------------------------------------------------- */
/*                                   Survey                                   */
/* -------------------------------------------------------------------------- */

const STEP =
  /(?<![\p{L}\d])(?:STEP|ÉTAPE|ETAPE|PASO|SCHRITT)\s+(\d{1,2})\s*(?:OF|SUR|DE|\/|VON)\s*(\d{1,2})(?!\d)/iu;
const HEADER_EDGE = 200;
const PAGE_MIN = 320;
const ICON_MAX = 64;

function markersOf(name) {
  const m = parseFigmaMarkers(name);
  return m.kind === null && m.flags.length === 0 ? null : m;
}

function surveyFrame(frame) {
  const texts = [];
  const flagged = [];
  const vectorGroups = [];
  const icons = [];
  const hiddenSiblings = [];
  const repeated = [];
  const insideVector = new Set();

  const containers = [frame];
  walk(frame, (node, ax, ay, depth, parent) => {
    if (node.type === 'text') texts.push({ id: node.id, name: node.name, x: ax, y: ay, depth });
    const markers = markersOf(node.name);
    if (markers) flagged.push({ id: node.id, name: short(node.name), markers });
    if (node.children.length > 0) containers.push(node);
    if (insideVector.has(parent?.id)) {
      insideVector.add(node.id);
    } else if (isVectorArt(node)) {
      insideVector.add(node.id);
      if (Math.max(node.width, node.height) <= ICON_MAX) {
        icons.push(`${node.id} ${round(node.width)}×${round(node.height)}`);
      } else {
        vectorGroups.push({
          id: node.id,
          name: node.name,
          width: round(node.width),
          height: round(node.height),
          leaves: countLeaves(node),
        });
      }
    }
  });

  for (const container of containers) {
    /* Hidden same-size siblings: ≥ 2 within ±2 px, ≥ 1 hidden. */
    const left = [...container.children];
    while (left.length > 0) {
      const head = left.shift();
      const group = [head];
      for (let i = left.length - 1; i >= 0; i--) {
        const other = left[i];
        if (
          Math.abs(other.width - head.width) <= TOLERANCE &&
          Math.abs(other.height - head.height) <= TOLERANCE &&
          overlap(other, head)
        ) {
          group.push(other);
          left.splice(i, 1);
        }
      }
      if (group.length >= 2 && group.some((node) => node.hidden) && head.width > ICON_MAX) {
        group.sort((a, b) => container.children.indexOf(a) - container.children.indexOf(b));
        hiddenSiblings.push({
          parentId: container.id,
          parentName: container.name,
          width: round(head.width),
          height: round(head.height),
          ids: group.map((node) => node.id),
          hidden: group.filter((node) => node.hidden).map((node) => node.id),
        });
      }
    }

    /* Repeated cards: ≥ 3 sibling containers, same width ±2 px, same child types. */
    const signature = (node) =>
      node.children
        .map((child) => child.type)
        .sort()
        .join(',');
    const cards = container.children.filter(
      (node) => CONTAINERS.has(node.type) && node.children.length >= 2
    );
    const seen = new Set();
    for (const card of cards) {
      if (seen.has(card)) continue;
      const same = cards.filter(
        (other) =>
          Math.abs(other.width - card.width) <= TOLERANCE && signature(other) === signature(card)
      );
      same.forEach((node) => seen.add(node));
      if (same.length >= 3) {
        repeated.push({
          parentId: container.id,
          parentName: container.name,
          width: round(card.width),
          ids: same.map((node) => node.id),
          names: same.map((node) => node.name),
        });
      }
    }
  }

  /* Header: text layers whose top is within the first 200 px. */
  const header = texts
    .filter((text) => text.y < HEADER_EDGE)
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((text) => short(text.name, 40));
  const headerSignature = [...new Set(header.map((name) => name.toLowerCase()))].sort().join(' | ');

  /* Step text: the shallowest « STEP n OF m ». */
  const stepText = texts
    .filter((text) => STEP.test(text.name))
    .sort((a, b) => a.depth - b.depth || a.y - b.y)[0];
  const stepMatch = stepText ? STEP.exec(stepText.name) : null;
  const step = stepMatch
    ? {
        n: Number(stepMatch[1]),
        of: Number(stepMatch[2]),
        text: short(stepText.name, 40),
        id: stepText.id,
      }
    : null;

  /* Bands: direct children merged by vertical overlap; small top layers form the header band. */
  const placed = frame.children
    .map((child) => ({ node: child, top: child.y, bottom: child.y + child.height }))
    .sort((a, b) => a.top - b.top || b.bottom - a.bottom);
  const headerBand = placed.filter((item) => item.bottom <= HEADER_EDGE * 0.75);
  const rest = placed.filter((item) => item.bottom > HEADER_EDGE * 0.75);
  const merged = [];
  for (const item of rest) {
    const last = merged.at(-1);
    if (last && item.top < last.bottom - 1) {
      last.items.push(item);
      last.bottom = Math.max(last.bottom, item.bottom);
    } else {
      merged.push({ top: item.top, bottom: item.bottom, items: [item] });
    }
  }
  if (headerBand.length > 0) {
    merged.unshift({
      top: Math.min(...headerBand.map((item) => item.top)),
      bottom: Math.max(...headerBand.map((item) => item.bottom)),
      items: headerBand,
      header: true,
    });
  }
  const firstText = (node) => {
    if (node.type === 'text') return node.name;
    for (const child of node.children) {
      const found = firstText(child);
      if (found) return found;
    }
    return '';
  };
  const bands = merged.map((band) => ({
    top: round(band.top),
    bottom: round(band.bottom),
    ...(band.header ? { header: true } : {}),
    ids: band.items.map((item) => item.node.id),
    label: short(
      band.items
        .map((item) => firstText(item.node))
        .filter(Boolean)
        .sort((a, b) => b.length - a.length)[0] ?? band.items[0].node.name,
      60
    ),
    hidden: band.items.filter((item) => item.node.hidden).map((item) => item.node.id),
  }));

  return {
    id: frame.id,
    name: frame.name,
    width: round(frame.width),
    height: round(frame.height),
    markers: parseFigmaMarkers(frame.name),
    children: frame.children.length,
    header,
    headerSignature,
    step,
    bands,
    hiddenSiblings,
    vectorGroups,
    icons,
    repeated,
    flagged,
    texts: texts.length,
    shortTexts: texts.filter((text) => text.name.length <= 30).length,
    topRightSquare: frame.children
      .filter(
        (child) =>
          Math.abs(child.width - child.height) <= TOLERANCE &&
          child.width <= ICON_MAX &&
          child.x >= frame.width * 0.75 &&
          child.y <= frame.height * 0.25
      )
      .map((child) => child.id),
  };
}

/**
 * `get_metadata` XML (or its saved tool result) → the survey object. Frames
 * smaller than 320 × 320 px at the top level count as stray layers.
 */
export function surveyMetadata(raw) {
  const roots = parseMetadataXml(metadataText(raw));
  const canvas = roots.find((node) => node.type === 'canvas') ?? {
    id: null,
    name: '',
    children: roots,
  };

  /* Sections hold frames of their own: lift them to the top level. */
  const top = [];
  const lift = (nodes) => {
    for (const node of nodes) {
      if (node.type === 'section') lift(node.children);
      else top.push(node);
    }
  };
  lift(canvas.children);

  const isPage = (node) =>
    CONTAINERS.has(node.type) &&
    node.width >= PAGE_MIN &&
    node.height >= PAGE_MIN &&
    node.children.length > 0;
  const frames = top.filter(isPage).map(surveyFrame);
  const outside = top
    .filter((node) => !isPage(node))
    .map((node) => ({
      id: node.id,
      type: node.type,
      name: short(node.name),
      width: round(node.width),
      height: round(node.height),
      ...(node.hidden ? { hidden: true } : {}),
    }));

  const byName = new Map();
  for (const frame of frames) {
    const key = frame.name.trim().toLowerCase();
    byName.set(key, [...(byName.get(key) ?? []), frame.id]);
  }
  const duplicateNames = [...byName.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([name, ids]) => ({ name, ids }));

  /* Flows: marked steps first, then frames with step text of the same total. */
  const flowCandidates = [];
  const marked = new Map();
  for (const frame of frames) {
    if (frame.markers.kind === 'flow' && frame.markers.key) {
      marked.set(frame.markers.key, [...(marked.get(frame.markers.key) ?? []), frame]);
    }
  }
  for (const [key, steps] of marked) {
    flowCandidates.push({
      reason: 'marker',
      key,
      steps: steps
        .sort((a, b) => (a.markers.n ?? 99) - (b.markers.n ?? 99))
        .map((frame) => ({ n: frame.markers.n, frameId: frame.id, name: frame.name })),
    });
  }
  const byTotal = new Map();
  for (const frame of frames) {
    if (frame.step && frame.markers.kind !== 'flow') {
      byTotal.set(frame.step.of, [...(byTotal.get(frame.step.of) ?? []), frame]);
    }
  }
  for (const [of, steps] of byTotal) {
    if (steps.length < 2) continue;
    flowCandidates.push({
      reason: 'step text',
      of,
      sharedHeader: new Set(steps.map((frame) => frame.headerSignature)).size === 1,
      steps: steps
        .sort((a, b) => a.step.n - b.step.n)
        .map((frame) => ({ n: frame.step.n, frameId: frame.id, name: frame.name })),
    });
  }

  /* Overlays: marked, or a viewport-high frame of short links with a close glyph top right. */
  const overlayCandidates = frames
    .filter(
      (frame) =>
        frame.markers.kind === 'overlay' ||
        (frame.height <= 1200 &&
          frame.texts >= 4 &&
          frame.shortTexts >= frame.texts * 0.8 &&
          frame.topRightSquare.length > 0 &&
          !frame.step)
    )
    .map((frame) => ({
      frameId: frame.id,
      name: frame.name,
      reason: frame.markers.kind === 'overlay' ? 'marker' : 'short links + close glyph top right',
    }));

  return {
    page: { id: canvas.id, name: canvas.name },
    frames,
    duplicateNames,
    outside,
    flowCandidates,
    overlayCandidates,
  };
}

/** A few lines for the terminal: what the survey found. */
export function surveySummary(survey) {
  const lines = [
    `Page ${survey.page.id ?? '?'} « ${survey.page.name} »: ${survey.frames.length} frames`,
  ];
  for (const frame of survey.frames) {
    const bits = [
      `${frame.width}×${frame.height}`,
      `${frame.bands.length} bands`,
      frame.markers.kind ? `${frame.markers.kind}:${frame.markers.key ?? '?'}` : null,
      frame.step ? `step ${frame.step.n}/${frame.step.of}` : null,
      frame.hiddenSiblings.length ? `${frame.hiddenSiblings.length} hidden-sibling sets` : null,
      frame.repeated.length ? `${frame.repeated.length} repeated sets` : null,
    ].filter(Boolean);
    lines.push(`  ${frame.id} « ${frame.name} » — ${bits.join(', ')}`);
  }
  for (const flow of survey.flowCandidates) {
    lines.push(`Flow (${flow.reason}): ${flow.steps.map((s) => `${s.n}=${s.frameId}`).join(' ')}`);
  }
  for (const overlay of survey.overlayCandidates)
    lines.push(`Overlay: ${overlay.frameId} « ${overlay.name} »`);
  for (const dup of survey.duplicateNames)
    lines.push(`Same name « ${dup.name} »: ${dup.ids.join(', ')}`);
  if (survey.outside.length) lines.push(`Outside frames: ${survey.outside.length} layers`);
  return lines.join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [input, output] = process.argv.slice(2);
  if (!input) {
    console.error('Usage: node survey.mjs <metadata.xml> [out.json]');
    process.exit(2);
  }
  const survey = surveyMetadata(readFileSync(input, 'utf8'));
  const out = output ?? path.join(path.dirname(input), 'survey.json');
  writeFileSync(out, `${JSON.stringify(survey, null, 2)}\n`);
  console.log(surveySummary(survey));
  console.log(`→ ${out}`);
}
