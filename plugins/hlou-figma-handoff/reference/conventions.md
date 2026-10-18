# Figma naming conventions and bundle rules

Hlou reads these markers in layer names — through this skill, its designer checklist and
its own Figma import. **Markers are hints, never requirements**: a file without any is
classified by the heuristics in `SKILL.md`. `scripts/lib/markers.mjs` parses them.

## Markers

Case-insensitive; a name is split on whitespace.

| Marker              | On                           | Means                                            |
| ------------------- | ---------------------------- | ------------------------------------------------ |
| `page/<slug>`       | top-level frame              | a site page                                      |
| `section/<name>`    | direct child of a page frame | a section (`section/hero`, `section/faq`)        |
| `flow:<key>/<n>`    | top-level frame              | step _n_ of a multi-step flow (`flow:booking/1`) |
| `overlay/<key>`     | top-level frame              | a menu, modal or drawer, not a page              |
| `@slider`           | group / frame                | its children (hidden ones included) are slides   |
| `@export`           | any node                     | export as one asset (SVG if vector, else PNG)    |
| `@raster`           | any node                     | flatten to one image                             |
| `@collection:<key>` | a repeated card              | records of collection `<key>`                    |
| `@ignore`           | any node                     | leave out                                        |

How a name is read:

- The **first** kind token wins (`page/`, `section/`, `flow:`, `overlay/`); a later one
  stays in the label. `page/our-commitment Our commitment` → page `our-commitment`,
  label « Our commitment ».
- `page/` and `section/` take a **slug**: lowercased, `_` → `-` (`section/Room_List` →
  `room-list`). `flow:` and `overlay/` take a **key**: lowercased, `-` → `_`
  (`flow:Booking-Flow/2` → `booking_flow`).
- A recognised marker whose slug or key is still invalid **still counts**, without a key
  (`page/Hôtel` is a page with no slug: pick one). So does a flow whose step number is
  outside 1–8.
- `@slider @export @raster @ignore @collection:<key>` count anywhere in the name, each
  once (a repeat is dropped). Only `@collection` takes `:<key>`; `@export:svg` is not a
  flag and stays in the label. `@collection` without a valid key is still a collection
  flag: name the collection yourself.
- An unknown `@word` stays in the label.

## Names in the manifest

- **slug** (`pages[].slug`, `flows[].steps[].page`, `overlays[].page`):
  `^[a-z0-9]+(?:-[a-z0-9]+)*$`, at most 60 characters — `home`, `our-commitment`,
  `booking-2`.
- **key** (`flows[].key`, `flows[].steps[].id`, `overlays[].key`, `collections[].key`,
  `collections[].fields[].key`): `^[a-z][a-z0-9_]{0,31}$` — `booking`, `rooms`,
  `price_per_night`.
- **colour** (`tokens.colors[].value`): `#rrggbb` or `#rrggbbaa`, lowercase.
- `source.exportedAt`: ISO 8601 with an offset (`2026-10-18T09:30:00+01:00` or `…Z`).

## Rules the validator applies beyond the schema

- Page slugs, asset refs, flow keys, overlay keys and collection keys are unique; so are
  step ids within a flow, field keys within a collection and section ids within a page.
- `pages[].html` is under `pages/`, `pages[].render` under `renders/`, `assets[].path`
  under `assets/`. A path is relative and posix: no leading `/`, no `\`, no `.` or `..`
  segment, no empty segment, at most 200 characters.
- An asset's extension matches its kind, case-insensitively: `image` → png, jpg, jpeg,
  webp; `svg` → svg; `font` → woff2, ttf, otf.
- Every flow step and overlay names an existing page.
- A font with `source: "file"` lists its `files`, each the `path` of an asset of kind
  `font`.
- Every file the manifest names is in the bundle, and every file in `pages/`, `assets/`
  and `renders/` is named by the manifest.
- Renders are PNG, at most 2000 px on the long edge; raster assets at most 2400 px.
- Pages hold no `<script>` and load nothing from the network; every `../assets/…` they
  use is in the bundle; when a page marks sections with `data-hl-section`, every section
  of its manifest entry is marked.
- Limits: 24 pages, 400 assets, 32 colours, 8 fonts, 24 text styles, 2–8 steps per flow,
  100 records per collection, 40 notes; 600 files, 50 MiB zipped, 200 MiB unzipped, a
  manifest of at most 2 MiB.
