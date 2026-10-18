/*
 * Test helpers: an invented « Maison Exemple » bundle written to a temp
 * folder, header-only images, and where the Hlou repository's fixtures are
 * when this folder sits in it (a published copy has none; tests then skip).
 */

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { findRepoRoot } from '../refresh-references.mjs';

export const repoRoot = findRepoRoot();

/** A path inside the repository, or null outside it. */
export function repoPath(...parts) {
  return repoRoot ? path.join(repoRoot, ...parts) : null;
}

export const CONTRACT_FIXTURES = repoPath(
  'packages',
  'contracts',
  'src',
  'handoff',
  '__fixtures__'
);
export const EVAL_BUNDLES = repoPath(
  'packages',
  'api',
  'src',
  'evals',
  'agent',
  '__fixtures__',
  'handoff'
);

/** The first 33 bytes of a PNG of `width` × `height`: all a header reader needs. */
export function png(width, height) {
  const bytes = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write('IHDR', 12, 'ascii');
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  bytes[24] = 8; // bit depth
  bytes[25] = 6; // RGBA
  return bytes;
}

export function exampleManifest() {
  return {
    hlou: 1,
    format: 'figma-handoff',
    source: {
      tool: 'figma',
      fileName: 'Maison Exemple',
      exportedAt: '2026-10-18T10:00:00+01:00',
      generator: 'hlou-figma-handoff@1.0.0',
    },
    locale: 'fr',
    pages: [
      {
        slug: 'home',
        title: 'Accueil',
        html: 'pages/home.html',
        render: 'renders/home.png',
        frameId: '10:1',
        width: 1440,
        sections: [
          { id: 'header', name: 'En-tête', role: 'header', hints: ['menu-trigger'] },
          { id: 'hero', name: 'Hero', role: 'hero', hints: ['slider', 'hidden-siblings:2'] },
        ],
      },
    ],
    tokens: {
      colors: [{ name: 'Encre', value: '#1b1b1f', usage: 12 }],
      fonts: [{ family: 'Inter', source: 'google', weights: [400, 600] }],
    },
    assets: [
      { ref: 'logo', path: 'assets/logo.svg', kind: 'svg', role: 'logo', alt: 'Maison Exemple' },
      {
        ref: 'hero',
        path: 'assets/hero.png',
        kind: 'image',
        role: 'photo',
        alt: 'La façade',
        width: 1200,
        height: 800,
      },
    ],
  };
}

export const EXAMPLE_HTML = `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <title>Accueil</title>
    <style>
      :root { --color-ink: #1b1b1f; --font-heading: 'Inter', sans-serif; }
      .hero { background-image: url('../assets/hero.png'); }
    </style>
  </head>
  <body>
    <header data-hl-section="header"><img src="../assets/logo.svg" alt="Maison Exemple" /></header>
    <section data-hl-section="hero" class="hero"><h1>Bienvenue à la Maison Exemple</h1></section>
  </body>
</html>
`;

/**
 * Writes the example bundle to a new temp folder and returns its path.
 * `change(manifest, files)` may edit both before they are written; `files`
 * maps a bundle path to its bytes or text (null removes it).
 */
export function makeBundle(change = () => {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'hlou-handoff-'));
  const manifest = exampleManifest();
  const files = {
    'pages/home.html': EXAMPLE_HTML,
    'renders/home.png': png(1000, 1800),
    'assets/logo.svg':
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>',
    'assets/hero.png': png(1200, 800),
  };
  change(manifest, files);
  files['hlou-handoff.json'] ??= `${JSON.stringify(manifest, null, 2)}\n`;
  for (const [name, data] of Object.entries(files)) {
    if (data === null) continue;
    const target = path.join(dir, name);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, data);
  }
  return dir;
}
