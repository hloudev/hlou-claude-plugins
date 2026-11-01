# The spec target: writing a Figma design into a Hlou starter

Run inside a **Hlou starter** — a folder with `hlou/site/site.json` (an export of a
Hlou project, or a fresh starter) — the skill writes the design into the folder's
**site spec** instead of packing a zip. `node PLUGIN/scripts/spec-target.mjs detect`
says which target the current folder is.

The survey, the classification (markers first, then the heuristics, then the user's OK),
the reading of each frame, the assets, the fonts and the collections are **the same** as
for a bundle: build `WORK/bundle/` as usual and validate it. The bundle is the
checked intermediate; this step translates it into the spec.

The starter's own skill **`hlou-site-spec`** (`.claude/skills/hlou-site-spec/SKILL.md`
in the starter) is the reference for the spec's files, keys, blocks and error codes.
Read it first. `example-spec/` beside this file is the contract's minimal fixture
written as a spec: the shape to follow.

## What goes where

| From the bundle                      | Into the spec                                                                                                                                                                                                                  |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `assets[]` (images, SVG, font files) | `node PLUGIN/scripts/spec-target.mjs media WORK/bundle .` copies them to `public/media/<file-slug>/` and prints `ref → /media/<file-slug>/<file>`. Use those paths.                                                            |
| `tokens.colors`                      | `site.json` › `theme.colors`: role `paper` (the page background), `ink` (body text), `accent` (buttons, links); other colours as roles keyed by their name (`sand`).                                                           |
| `tokens.fonts`                       | `theme.fonts`: role `heading` and `body` (and more by use). `google` → `source: "google"`, `family`, `weights`. `file` → `source: "custom"`, `family`, `src` (its media path). `unknown` → leave the role as it is and say so. |
| `tokens.text`                        | `theme.typeScale` when the sizes map cleanly (xs, sm, md, lg, xl); otherwise leave it.                                                                                                                                         |
| `pages[]` (and flow steps)           | `pages/<slug>.json`: `path` (`/` for `home`, else `/<slug>`), `title`, `status: "ready"` (so `pnpm dev` shows it), `position`, `parent` (`home` for the others).                                                               |
| `pages[].sections[]`                 | `sections[]`: `key` = the section `id`, `label` = its `name`; its slots: one per editable text or image the frame shows.                                                                                                       |
| the frame's design context           | the page's `document`: the `header` and `footer` instances first and last, then one block per section, chosen from the table below, props bound to the slots.                                                                  |
| page copy                            | `content/<sourceLocale>.json` only: `<slug>/<slotKey>` values, verbatim from the file. Other locales are translated later, in Hlou or by the developer.                                                                        |
| an overlay of kind `menu`            | not a page: its links become `site/nav.links` (a `navigation` value, `page` = a page slug).                                                                                                                                    |
| a flow                               | one page per step (slugs as in the bundle); the steps link to each other with buttons. Note the flow in `NOTES.md`.                                                                                                            |
| `collections[]`                      | `collections/<key>.json`: `name`, `fields` (same types), `records` with a `key` (a slug of the first text value), `status: "published"`, `data`.                                                                               |
| `notes`                              | `NOTES.md` in `WORK`, and the summary you give the user.                                                                                                                                                                       |

## Blocks by section

| Section (role, hints)               | Block                                                                                                         |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `header`                            | the `header` component (`instanceOf: "header"`); its links in `site/nav.links`                                |
| `footer`                            | the `footer` component                                                                                        |
| `hero`                              | `hero` (`title`, `description`, `image`, `buttons`)                                                           |
| `hero` + `slider`, `gallery`        | `carousel`, or `gallery`                                                                                      |
| a page title band                   | `pageHeader` (`eyebrow`, `title`)                                                                             |
| `list` + `collection:<key>`         | `listings` with `source: { "$collection": "<key>" }` and its `mapping`                                        |
| cards of features, offers, services | `featureGrid` or `cards`                                                                                      |
| figures                             | `stats`                                                                                                       |
| a quotation                         | `quote`                                                                                                       |
| questions and answers, `accordion`  | `accordion`                                                                                                   |
| `cta`                               | `ctaBand`                                                                                                     |
| `form`, `booking-bar`               | `form` (bound to a collection's form) or, for dates, `datePicker`                                             |
| anything else                       | `section` + `stack` with `heading`, `text`, `image`, `buttons`, or a `custom` block noted for a `codeVariant` |

A prop left out takes the block's default (`renderer/blocks/<key>/defaults.ts`), which
may be placeholder copy: set every prop the design shows, empty the ones it does not
(`"eyebrow": ""`, `"buttons": []`). Bind every visible text and image to a slot
(`{ "$slot": "<slotKey>" }`), so it can be translated and edited in Hlou.

## In an existing spec

- **Never remove** what is already there: add pages; when a page with the slug exists,
  ask the user whether to replace its sections and document, or to use another slug.
- **Theme**: the design's colours and fonts replace the theme's roles of the same key
  (`paper`, `ink`, `accent`, `heading`, `body`); leave other roles alone. Say what
  changed.
- **Locales**: write the source locale's content only; tell the user which locales now
  miss the new slots' values.
- **Media**: the script never replaces a file; a different file with the same name gets
  a new one (`hero-2.png`).
- Never edit `hlou/site.lock.json` or `site/`.

## Check

```bash
pnpm hlou:compile
```

Fix every error it prints (codes in the starter's `hlou-site-spec` skill) and run it
again until it prints the page count and no error. Then tell the user to run `pnpm dev`
and open `/<sourceLocale>/`, and that the import back into Hlou (Réglages › Export et
import) brings the pages in.
