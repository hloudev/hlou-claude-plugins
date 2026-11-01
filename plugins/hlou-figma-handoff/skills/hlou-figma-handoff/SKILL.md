---
name: hlou-figma-handoff
description: Turn a Figma design into a Hlou site — inside a Hlou starter folder (one with hlou/site/site.json), written straight into its site spec; anywhere else, as a Hlou handoff bundle (a .zip the Hlou agent builds a site from). Use when the user wants to send/export/prepare a Figma file for Hlou, build Hlou pages from a Figma frame, make a Hlou bundle, or hand a design to Hlou.
---

# Figma → Hlou (handoff bundle, or the site spec)

Hlou builds websites with an agent. It can read a Figma file over REST, but it misses
hidden layers, flows and overlays. You can read the same file through the **Figma MCP**
and package it as a **« Hlou handoff bundle »**: a zip of self-contained HTML pages,
optimised assets, full-frame renders and a `hlou-handoff.json` manifest. Hlou's agent
then rebuilds the site from it.

**Two targets, one procedure.** Inside a **Hlou starter** (the current directory has
`hlou/site/site.json`: an exported Hlou project or a fresh starter), the same bundle is
built as a checked intermediate and then **written into the site spec** (`hlou/site/`)
and `public/media/`, and compiled with `pnpm hlou:compile` (step 10). Anywhere else, the
bundle is packed as a zip for Hlou's agent panel (step 9), as before.

The output is **a bundle or spec files, never project code**. Figma's
`get_design_context` returns React and Tailwind: read it as a reference, never ship it.

## Where things are

- **`PLUGIN`** — this plugin's folder: `${CLAUDE_PLUGIN_ROOT}` when set, otherwise two
  levels above this file's folder. It holds `scripts/` and `reference/`.
- **`TARGET`** — `node PLUGIN/scripts/spec-target.mjs detect` in the current directory:
  `"spec"` in a Hlou starter, `"bundle"` anywhere else. Run it first and say which.
- **`WORK`** — `_work/<file-slug>/` in the current directory (`<file-slug>`: the Figma
  file name as a slug). **In a starter** (`TARGET` spec), use
  `${TMPDIR:-/tmp}/hlou-figma-handoff/<file-slug>/` instead: nothing of the work may
  land in the site folder, which goes back to Hlou. Everything you fetch and write goes
  here:

  ```
  _work/<file-slug>/
    metadata.xml        get_metadata output (or the saved tool result)
    survey.json         scripts/survey.mjs output — read this, not the XML
    raw/                downloads before resizing
    bundle/             the bundle itself
      hlou-handoff.json
      pages/<slug>.html
      assets/<ref>.<ext>
      renders/<slug>.png
    NOTES.md            what you decided, guessed or fixed by hand
  ```

- References: `PLUGIN/reference/conventions.md` (layer-name markers and the bundle rules),
  `hints.md` (section hints), `handoff.schema.json` (the manifest's JSON Schema),
  `example-manifest.json` (a small valid manifest), `phosphor-icons.txt` (icon names Hlou
  bundles), `google-fonts.txt` (Google Fonts families).

Read `conventions.md` and `example-manifest.json` once before step 3.

## Rules

- **Never invent.** Copy, prices, names and images come from the file, verbatim. If the
  Figma MCP is not available or cannot open the file, say so and stop: never write a
  bundle from memory or from a screenshot alone.
- Ask the user when the file is ambiguous (two frames with the same name, a frame that
  may or may not be a page); record the answer in `NOTES.md`.
- Reuse the `create_session` id on every Figma MCP call.
- Tool results that are too large are saved to a file by Claude Code: work from that file
  (`jq`, the scripts) rather than reading it whole.

## 0. Check

1. The Figma MCP is connected: call `whoami`. If it fails or the tools are missing, tell
   the user to install Figma's MCP server (remote `https://mcp.figma.com/mcp`, or the
   desktop app's server) and authorise it, then stop.
2. `node -v` is 20 or later.
3. `node PLUGIN/scripts/spec-target.mjs detect` → `TARGET`. With `"spec"`, the design's
   language is the site's `sourceLocale` (ask only if the design is in another one), and
   `pages` lists the slugs already taken. With a `problem`, fix `hlou/site/site.json`
   first.
4. Ask for the file URL (`figma.com/design/<fileKey>/…`), the page if the file has
   several (`get_metadata` without `nodeId` lists them), and the design's language
   (`locale`: `fr`, `en`, `ar`…). Create `WORK`.

## 1. Session

`create_session(fileKey, "Hlou handoff bundle")`. Keep the id; pass it as `sessionId`
everywhere below.

## 2. Survey → `WORK/metadata.xml`, `WORK/survey.json`

1. `get_metadata(fileKey, nodeId: <page id>)`. Save the XML to `WORK/metadata.xml`. When
   the result was too large and saved to a file, pass that file as is.
2. `node PLUGIN/scripts/survey.mjs WORK/metadata.xml` → `WORK/survey.json` and a summary.
3. Read the summary, then the parts of `survey.json` you need. For each top-level frame
   it gives: `markers` (layer-name markers), `header` / `headerSignature` (text layers in
   the top 200 px), `step` (« STEP 2 OF 4 »), `bands` (direct children grouped by vertical
   overlap: candidate sections, the first one flagged `header`), `hiddenSiblings` (same
   size, overlapping, at least one hidden: slides or states), `vectorGroups` (vector-only
   art: one SVG each), `icons` (`id W×H`, vector art ≤ 64 px), `repeated` (≥ 3 sibling
   cards of one shape: collection candidates) and `flagged` (marked layers). At the top
   level: `duplicateNames`, `outside` (layers outside any page-sized frame),
   `flowCandidates`, `overlayCandidates`.

`get_metadata` omits vector nodes: an empty frame is usually an icon.

## 3. Classify — and wait for an OK

From the survey, decide what each top-level frame is. Markers first
(`conventions.md`), then:

- frames sharing a header signature and a step text « STEP/ÉTAPE N OF/SUR M » → **one
  flow**, steps in N order (`flowCandidates`);
- a viewport-high frame of short links with a close glyph and no hero → an **overlay** of
  kind `menu` (`overlayCandidates`); a centred panel over a dimmed page → `modal`; a panel
  from one side → `drawer`;
- the same name twice (`duplicateNames`) → **ask** which one is current; leave the other
  out and say so in `notes`;
- layers outside frames (`outside`) → not pages: their text goes to `notes` when it says
  something about the design, otherwise nothing;
- every other page-sized frame → a **page**. Slugs: `home` for the home page, then the
  frame name as a slug (`our-commitment`); flow steps `<flow>-<n>` (`booking-1`).

Show the user a short table — slug, kind (page / flow step / overlay / left out), frame
id, frame name — plus the questions, and **wait for an OK** before reading any page.

## 4. Read each page, step and overlay

For each frame you keep:

1. **Render** → `bundle/renders/<slug>.png`: `get_screenshot` on the frame; download
   the URL it returns with `curl -sSL -o`. A render is at most 2000 px on its long edge
   and should stay readable: `maxDimension` = `min(2000, max(1000, ⌈600 × height / width⌉))`
   (a 1920 × 1080 frame → 1000; a 1920 × 5000 frame → 1563, 600 px wide).
2. **Design context, per section**: call `get_design_context` on each band's frames
   (direct children of the page frame), not on the whole frame — a whole page truncates.
   Load Figma's `figma-design-to-code` skill first, as the Figma MCP requires; use its
   advice to read the reference, but write the output this skill describes. Pass
   `clientFrameworks: "html"`, `clientLanguages: "html,css"`.
3. **Hidden layers matter**: slides of a slider are often hidden siblings
   (`hiddenSiblings`); read each one (`get_design_context` or `download_assets` on its
   id) — Hlou cannot see them otherwise.

Decide the sections: one per band, split or merged where the design says so (a header,
the hero, each titled block, the footer). Give each an `id` (a short slug: `header`,
`hero`, `rooms`, `faq`), a `name`, a `role` when obvious (`header`, `hero`, `list`,
`gallery`, `form`, `cta`, `footer`, `nav`), its `nodeId` when it is one node, and
`hints` from `hints.md` (`slider`, `hidden-siblings:<n>`, `accordion`, `form`,
`booking-bar`, `steps`, `summary`, `menu-trigger`, `collection:<key>`…).

## 5. Write `bundle/pages/<slug>.html`

Plain semantic HTML and **one `<style>`** — no Tailwind, no CDN, no `<script>`, no web
font by URL. Hlou draws these pages with scripts off and the network cut: a CDN would
draw an unstyled page.

- `<html lang="<locale>">`, `<meta charset="utf-8">`, a viewport meta, a `<title>`.
- **Tokens as CSS custom properties on `:root`** — Hlou reads them as the theme:
  `--color-<name>` for every colour you use, `--font-heading`, `--font-body`,
  `--space-<n>`. Use them through `var()` in the rules.
- Fonts by family name in `font-family` stacks (`'Inter', sans-serif`); a `file` font
  (step 7) may have an `@font-face` whose `src` is `url('../assets/<file>')`.
- **One element per manifest section**, carrying `data-hl-section="<id>"` (`<header>`,
  `<section>`, `<footer>`), in page order.
- Images as `../assets/<ref>.<ext>` with a real `alt`; CSS backgrounds as
  `url('../assets/<ref>.<ext>')`.
- A slider's slides **all present**, hidden ones included, inside
  `<div data-hl-hint="slider">`: the visible slide first, then the hidden ones in layer
  order. Other hints may go on elements too
  (`data-hl-hint="menu-trigger"` on the menu button).
- Real text, verbatim, including its case as typed (`text-transform` for display case).
- Links between pages: `href="<slug>.html"`; the menu trigger links to the overlay page.
- Layout with flex or grid at the frame's width (`max-width` = frame width); good
  enough that the render and the page tell the same story, not pixel-perfect.
- Write the `:root` tokens, the base rules and the shared header and footer once (from
  the home page) and start every page from them. With many pages, subagents can write
  pages in parallel from that base and the same `sessionId`; give each its own asset
  prefix (`<slug>-…`) and merge duplicates after.

## 6. Assets → `bundle/assets/`

Use the asset URLs `get_design_context` already gave you — they are the original
bytes, mapped to their nodes — and `download_assets(nodeId)` for the rest (its `export`;
its `rawImages` are not mapped to nodes). Download every URL promptly (they expire) into
`WORK/raw/`, then copy or convert into `bundle/assets/<ref>.<ext>`.

- **Check the real format** with `file`: the extension in a context URL can lie (a
  `.png` URL serving a JPEG). Name the file by what it is.
- An SVG **export** of a node inside a frame carries its ancestors' backgrounds (the
  canvas colour, the page frame) as full-size `<rect>`s: run
  `node PLUGIN/scripts/clean-svg.mjs <files>` on every exported SVG. SVG URLs from
  `get_design_context` are clean.
- Export what repeats across pages (the logo, header and footer icons) once, and reuse
  it on every page.

- **Vector-only art at any size** (a logo, an illustration, `vectorGroups`) → **one SVG**
  of the whole group (`download_assets` on the group: its `svgAssets`, or an `export`
  with `defaultFormat: "svg"`). Never a pile of pieces.
- An **image fill** → the original bytes (`rawImages`), in their format.
- Masks, effects, collages, `@raster` → one PNG export of the node.
- `@ignore` → skipped.
- **Icons**: a small SVG each. When it matches a name in `phosphor-icons.txt`, also set
  `phosphor: "<name>"` — the schema still needs the `path`; Hlou prefers the name.
- Downscale anything over **2400 px** on the long edge; never upscale; keep the format,
  except an **opaque photo stored as PNG**: save it as JPEG (quality 80), it is many
  times smaller. macOS: `sips -g pixelWidth -g pixelHeight <file>`, then
  `sips -Z 2400 <file>` only if larger (`-s format jpeg -s formatOptions 80 … --out
x.jpg` to convert). Elsewhere: `magick <in> -resize '2400x2400>' <out>`. Hlou
  re-encodes to WebP on import. The same image used on several pages is one file
  (compare `shasum` of the downloads).
- Name refs as slugs (`logo`, `hero-1`, `room-atlas`); `path` is
  `assets/<ref>.<ext>`. Each asset gets `kind` (`image`, `svg`), `role` (`logo`, `icon`,
  `photo`, `illustration`, `background`), `nodeId`, `alt` in the design's language, and
  the file's `width` / `height` in pixels for rasters.

## 7. Fonts

From the design context, list the families with the weights and styles used.

- A family in `google-fonts.txt` (exact name) → `source: "google"`, `weights`
  (`[400, 600]`), `styles` (`["normal", "italic"]`). A variable axis such as `opsz` is
  not a weight.
- Otherwise → `source: "file"`: ask the user for the font files, copy them to
  `bundle/assets/`, list them as assets of kind `font`, role `font`, and in the font's
  `files` (bundle paths). None given → `source: "unknown"`, and say so in `notes`.

## 8. Collections

Repeated cards of one shape — `@collection:<key>`, or ≥ 3 same-structure siblings
(`repeated`: rooms, offers, team members) — become `collections[]`:

- `key` (`rooms`), `name` in the design's language, `source` (the parent's node id);
- `fields` typed in Hlou's vocabulary: `text`, `richtext`, `number`, `media`, `date`,
  `select`; a `money` field only if the user says their Hlou has it;
- `records` (≤ 100) with the cards' real values; an image value is an asset `ref`;
- the section that shows them gets the hint `collection:<key>`.

## 9. Manifest, validate, pack

Write `bundle/hlou-handoff.json` (shape: `example-manifest.json`, rules:
`handoff.schema.json` and `conventions.md`):

- `hlou: 1`, `format: "figma-handoff"`, `source` (`tool: "figma"`, `fileKey`,
  `fileName`, `exportedAt` — now, ISO 8601 with offset — and `generator`:
  `hlou-figma-handoff@<version>` with the version from `PLUGIN/.claude-plugin/plugin.json`),
  `locale`;
- `pages` (slug, title, html, render, frameId, width, sections), `flows` (key, label,
  steps of `{ id, label, page }`), `overlays` (key, kind, page, trigger: the section id
  that opens it);
- `tokens.colors` — the colours by use count, most used first, at most 32, lowercase
  hex, named by use (`Ink`, `Sand`, `Accent`); count them in your pages with the command
  below; `tokens.fonts` (step 7); `tokens.text` — up to 24 text styles (name, family,
  size, weight, lineHeight, letterSpacing);
- `assets`, `collections`;
- `notes` (≤ 40): frames left out and why, stray text, hidden states, anything the
  agent should know that the pages cannot say.

```bash
grep -ohiE '#[0-9a-f]{6}([0-9a-f]{2})?\b' WORK/bundle/pages/*.html | tr A-F a-f | sort | uniq -c | sort -rn
```

Then:

```bash
node PLUGIN/scripts/validate.mjs WORK/bundle
```

It prints `code path message` lines. Fix each and re-run until it prints nothing
(exit 0).

**`TARGET` spec: go to step 10 instead of packing.** Otherwise:

```bash
node PLUGIN/scripts/pack.mjs WORK/bundle <file-slug>-hlou-handoff.zip
```

Tell the user the zip's path and to attach it in Hlou's agent panel. Mention anything in
`NOTES.md` they should check.

## 10. Write the spec (`TARGET` spec only)

Read `PLUGIN/reference/spec-target.md` (what goes where, blocks by section, the rules
for an existing spec), the starter's own skill `.claude/skills/hlou-site-spec/SKILL.md`
(the files, keys, blocks and error codes), and `PLUGIN/reference/example-spec/` (the
contract's minimal fixture written as a spec). Then:

1. **Media**: `node PLUGIN/scripts/spec-target.mjs media WORK/bundle .` copies every
   asset to `public/media/<file-slug>/` without replacing any file, and prints each
   `ref`'s spec path. Use those paths.
2. **Theme**: the colours and fonts into `hlou/site/site.json` › `theme`.
3. **Pages**: one `hlou/site/pages/<slug>.json` per page and flow step, its sections and
   slots from the manifest's sections, its document with Hlou blocks bound to the slots.
4. **Content**: every slot's value, verbatim from the design, in
   `hlou/site/content/<sourceLocale>.json`; the menu's links in `site/nav.links`.
5. **Collections**: `hlou/site/collections/<key>.json` with the cards' records.
6. `pnpm hlou:compile`. Fix every error it prints and run it again until it prints the
   page count and no error. Never edit `site/` or `hlou/site.lock.json`.

Tell the user which pages, sections, theme roles, media and collections you wrote,
which locales still lack the new content, to run `pnpm dev` and open
`/<sourceLocale>/`, and that importing the folder into Hlou (Réglages › Export et
import) brings it in. Mention anything in `NOTES.md` they should check.
