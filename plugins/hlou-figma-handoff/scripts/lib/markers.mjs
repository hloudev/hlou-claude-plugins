import { HANDOFF_KEY_PATTERN, HANDOFF_LIMITS, HANDOFF_SLUG_PATTERN } from './contract.mjs';

/*
 * Figma naming markers — a JS port of the parser Hlou's REST importer uses,
 * tested against the same fixture. See reference/conventions.md.
 */

export const FIGMA_FLAG_NAMES = ['slider', 'export', 'raster', 'ignore', 'collection'];

/** `Booking-Flow` → `booking_flow`; null when still not a valid key. */
function normaliseKey(raw) {
  const key = raw.toLowerCase().replaceAll('-', '_');
  return HANDOFF_KEY_PATTERN.test(key) ? key : null;
}

/** `Our_Commitment` → `our-commitment`; null when still not a valid slug. */
function normaliseSlug(raw) {
  const slug = raw.toLowerCase().replaceAll('_', '-');
  return slug.length <= 60 && HANDOFF_SLUG_PATTERN.test(slug) ? slug : null;
}

function stepNumber(raw) {
  if (raw === undefined || !/^\d{1,3}$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 && n <= HANDOFF_LIMITS.flowStepsMax ? n : null;
}

const KIND_TOKEN = /^(page|section|overlay)\/(.*)$|^flow:([^/]*)(?:\/(.*))?$/i;
const FLAG_TOKEN = /^@(slider|export|raster|ignore|collection)(?::(.*))?$/i;

/**
 * The markers of one Figma layer name → `{ kind, key, n, flags, label }`.
 * Case-insensitive; the name is split on whitespace.
 *
 * - The **first** kind token wins (`page/<slug>`, `section/<name>`,
 *   `flow:<key>/<n>` with 1 ≤ n ≤ 8, `overlay/<key>`); later ones stay in `label`.
 * - `@slider @export @raster @ignore @collection:<key>` count anywhere, each
 *   once; `:arg` is read on `@collection` only, and a flag that takes none is
 *   not a flag when it carries one.
 * - Keys are lowercased with `-` → `_`, slugs with `_` → `-`; one still
 *   invalid is dropped (`key` null, or no `arg`) while the marker still counts,
 *   and so does an out-of-range `n`.
 * - An unknown `@word` stays in `label`. Never throws.
 */
export function parseFigmaMarkers(name) {
  const result = { kind: null, key: null, n: null, flags: [], label: '' };
  const label = [];
  const tokens = typeof name === 'string' ? name.split(/\s+/).filter(Boolean) : [];

  for (const token of tokens) {
    const flag = FLAG_TOKEN.exec(token);
    if (flag) {
      const flagName = (flag[1] ?? '').toLowerCase();
      const arg = flag[2];
      if (flagName !== 'collection' && arg !== undefined) {
        label.push(token);
        continue;
      }
      if (!result.flags.some((existing) => existing.name === flagName)) {
        const key = arg === undefined ? null : normaliseKey(arg);
        result.flags.push(key === null ? { name: flagName } : { name: flagName, arg: key });
      }
      continue;
    }

    const kind = result.kind === null ? KIND_TOKEN.exec(token) : null;
    if (kind) {
      if (kind[1] !== undefined) {
        const kindName = kind[1].toLowerCase();
        result.kind = kindName;
        result.key =
          kindName === 'overlay' ? normaliseKey(kind[2] ?? '') : normaliseSlug(kind[2] ?? '');
      } else {
        result.kind = 'flow';
        result.key = normaliseKey(kind[3] ?? '');
        result.n = stepNumber(kind[4]);
      }
      continue;
    }

    label.push(token);
  }

  result.label = label.join(' ').trim();
  return result;
}
