/*
 * The Hlou handoff bundle contract, v1 — a dependency-free JS port of the
 * TypeScript source Hlou reads bundles with. Keep it in step with that source:
 * the tests check the limits and run the same fixtures when the repo is there.
 */

/** What `format` says in every v1 manifest. */
export const HANDOFF_FORMAT = 'figma-handoff';

/** The manifest, at the bundle's root. */
export const HANDOFF_MANIFEST_PATH = 'hlou-handoff.json';

/** Where everything else sits. Nothing else is read. */
export const HANDOFF_DIRS = { pages: 'pages/', assets: 'assets/', renders: 'renders/' };

/** Every cap of a bundle, once. */
export const HANDOFF_LIMITS = {
  zippedBytes: 50 * 1024 * 1024,
  inflatedBytes: 200 * 1024 * 1024,
  entries: 600,
  manifestBytes: 2 * 1024 * 1024,
  renderMaxEdge: 2000,
  imageMaxEdge: 2400,
  pathLength: 200,
  pages: 24,
  assets: 400,
  colors: 32,
  fonts: 8,
  textStyles: 24,
  flowStepsMin: 2,
  flowStepsMax: 8,
  records: 100,
  notes: 40,
};

/** The extensions each asset `kind` may have, compared case-insensitively. */
export const HANDOFF_ASSET_EXTENSIONS = {
  image: ['png', 'jpg', 'jpeg', 'webp'],
  svg: ['svg'],
  font: ['woff2', 'ttf', 'otf'],
};

/** `home`, `our-commitment`, `booking-2`. */
export const HANDOFF_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** A collection key, a flow key, a flow step id. */
export const HANDOFF_KEY_PATTERN = /^[a-z][a-z0-9_]{0,31}$/;
/** `#rrggbb` or `#rrggbbaa`, lowercase. */
export const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}([0-9a-f]{2})?$/;

export const HANDOFF_PROBLEM_CODES = [
  'duplicateSlug',
  'duplicateAssetRef',
  'duplicateKey',
  'pagePathOutside',
  'assetPathOutside',
  'assetExtension',
  'flowPageMissing',
  'overlayPageMissing',
  'fontFileMissing',
  'sectionIdDuplicate',
];

const L = HANDOFF_LIMITS;

/**
 * Whether `path` may name a file of a bundle: posix and relative (no leading
 * `/`, no `\`, no NUL), no `..`, `.` or empty segment, at most
 * `pathLength` characters, and either the manifest or a file under one of
 * `HANDOFF_DIRS`.
 */
export function isHandoffPath(path) {
  if (typeof path !== 'string' || path.length === 0 || path.length > L.pathLength) return false;
  if (path.startsWith('/') || path.includes('\\') || path.includes('\0')) return false;
  if (path.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) {
    return false;
  }
  if (path === HANDOFF_MANIFEST_PATH) return true;
  return Object.values(HANDOFF_DIRS).some((dir) => path.startsWith(dir));
}

function isUnder(path, dir) {
  return isHandoffPath(path) && path.startsWith(dir);
}

/** `assets/hero.PNG` → `png`; `''` when there is none. */
export function extensionOf(path) {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase();
}

/** The schema's defaults, filled in (what the schema accepted, as a reader sees it). */
export function withDefaults(manifest) {
  return {
    ...manifest,
    flows: manifest.flows ?? [],
    overlays: manifest.overlays ?? [],
    collections: manifest.collections ?? [],
    notes: manifest.notes ?? [],
  };
}

function duplicates(items, value, report) {
  const seen = new Set();
  items.forEach((item, index) => {
    const key = value(item);
    if (seen.has(key)) report(index, key);
    seen.add(key);
  });
}

/**
 * The cross-references JSON Schema cannot say, for a manifest the schema
 * accepted: `{ code, path, message }[]`, `code` one of `HANDOFF_PROBLEM_CODES`.
 * Whether the named files exist is `validate.mjs`'s job, not this one's.
 */
export function handoffProblems(input) {
  const manifest = withDefaults(input);
  const problems = [];
  const add = (code, path, message) => problems.push({ code, path, message });

  /* Pages */
  duplicates(
    manifest.pages,
    (page) => page.slug,
    (i, slug) => add('duplicateSlug', ['pages', i, 'slug'], `Two pages have the slug « ${slug} »`)
  );
  manifest.pages.forEach((page, i) => {
    if (!isUnder(page.html, HANDOFF_DIRS.pages)) {
      add('pagePathOutside', ['pages', i, 'html'], `« ${page.html} » is not under pages/`);
    }
    if (page.render !== undefined && !isUnder(page.render, HANDOFF_DIRS.renders)) {
      add('pagePathOutside', ['pages', i, 'render'], `« ${page.render} » is not under renders/`);
    }
    duplicates(
      page.sections,
      (section) => section.id,
      (j, id) =>
        add(
          'sectionIdDuplicate',
          ['pages', i, 'sections', j, 'id'],
          `Two sections of « ${page.slug} » have the id « ${id} »`
        )
    );
  });
  const slugs = new Set(manifest.pages.map((page) => page.slug));

  /* Flows and overlays */
  duplicates(
    manifest.flows,
    (flow) => flow.key,
    (i, key) => add('duplicateKey', ['flows', i, 'key'], `Two flows have the key « ${key} »`)
  );
  manifest.flows.forEach((flow, i) => {
    duplicates(
      flow.steps,
      (step) => step.id,
      (j, id) =>
        add(
          'duplicateKey',
          ['flows', i, 'steps', j, 'id'],
          `Two steps of « ${flow.key} » have the id « ${id} »`
        )
    );
    flow.steps.forEach((step, j) => {
      if (!slugs.has(step.page)) {
        add(
          'flowPageMissing',
          ['flows', i, 'steps', j, 'page'],
          `No page has the slug « ${step.page} »`
        );
      }
    });
  });
  duplicates(
    manifest.overlays,
    (overlay) => overlay.key,
    (i, key) => add('duplicateKey', ['overlays', i, 'key'], `Two overlays have the key « ${key} »`)
  );
  manifest.overlays.forEach((overlay, i) => {
    if (!slugs.has(overlay.page)) {
      add(
        'overlayPageMissing',
        ['overlays', i, 'page'],
        `No page has the slug « ${overlay.page} »`
      );
    }
  });

  /* Assets */
  duplicates(
    manifest.assets,
    (asset) => asset.ref,
    (i, ref) => add('duplicateAssetRef', ['assets', i, 'ref'], `Two assets have the ref « ${ref} »`)
  );
  manifest.assets.forEach((asset, i) => {
    if (!isUnder(asset.path, HANDOFF_DIRS.assets)) {
      add('assetPathOutside', ['assets', i, 'path'], `« ${asset.path} » is not under assets/`);
      return;
    }
    const allowed = HANDOFF_ASSET_EXTENSIONS[asset.kind];
    if (!allowed.includes(extensionOf(asset.path))) {
      add(
        'assetExtension',
        ['assets', i, 'path'],
        `A ${asset.kind} asset is ${allowed.map((ext) => `.${ext}`).join(', ')}, not « ${asset.path} »`
      );
    }
  });

  /* Fonts */
  const fontPaths = new Set(
    manifest.assets.filter((asset) => asset.kind === 'font').map((asset) => asset.path)
  );
  manifest.tokens.fonts.forEach((font, i) => {
    if (font.source !== 'file') return;
    if (!font.files || font.files.length === 0) {
      add(
        'fontFileMissing',
        ['tokens', 'fonts', i, 'files'],
        `« ${font.family} » comes from a file but lists none`
      );
      return;
    }
    font.files.forEach((file, j) => {
      if (!fontPaths.has(file)) {
        add(
          'fontFileMissing',
          ['tokens', 'fonts', i, 'files', j],
          `« ${file} » is not the path of a font asset`
        );
      }
    });
  });

  /* Collections */
  duplicates(
    manifest.collections,
    (collection) => collection.key,
    (i, key) =>
      add('duplicateKey', ['collections', i, 'key'], `Two collections have the key « ${key} »`)
  );
  manifest.collections.forEach((collection, i) => {
    duplicates(
      collection.fields,
      (field) => field.key,
      (j, key) =>
        add(
          'duplicateKey',
          ['collections', i, 'fields', j, 'key'],
          `Two fields of « ${collection.key} » have the key « ${key} »`
        )
    );
  });

  return problems;
}
