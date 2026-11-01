# hlou-figma-handoff

A Claude Code plugin with one skill: it turns a Figma design into a **« Hlou handoff
bundle »** — a `.zip` of self-contained HTML pages, optimised assets, full-frame renders
and a `hlou-handoff.json` manifest that Hlou's agent builds a site from.

It reads the file through **Figma's own MCP server**, so it sees what a REST import
misses: hidden layers (slides of a slider), the steps of a multi-step flow, menus and
other overlays, vector art as one SVG.

## What you need

- [Claude Code](https://claude.com/claude-code).
- **Figma's MCP server**, connected and authorised in Claude Code: the remote server
  (`https://mcp.figma.com/mcp`) or the one the Figma desktop app serves. This plugin does
  not install it.
- Node.js 20 or later (the scripts have no dependencies; nothing to install).

## Install

From a local checkout:

```bash
claude --plugin-dir path/to/hlou-figma-handoff
```

From the Hlou marketplace ([hloudev/hlou-claude-plugins](https://github.com/hloudev/hlou-claude-plugins)):

```text
/plugin marketplace add hloudev/hlou-claude-plugins
/plugin install hlou-figma-handoff@hlou-claude-plugins
```

or, on Claude Code 2.1.275 or later, in one step:

```text
/plugin install hlou-figma-handoff --marketplace hloudev/hlou-claude-plugins
```

## Two targets

- **Inside a Hlou starter** (a folder with `hlou/site/site.json`: an export of a Hlou
  project, or a fresh starter), the skill writes the design **into the site spec**:
  pages, sections, theme colours and fonts, the copy in the source locale, media under
  `public/media/`, collections. It runs `pnpm hlou:compile` and fixes what it reports,
  so `pnpm dev` shows the pages and an import brings them into Hlou. Its work files go
  to a temp folder, never into the site.
- **Anywhere else**, it writes the handoff bundle zip for Hlou's agent panel, as below.

`node scripts/spec-target.mjs detect` says which one a folder is.

## Use

Ask Claude Code, in any folder:

> Prepare this Figma file for Hlou: https://www.figma.com/design/…

The skill checks the Figma MCP, surveys the page, shows you how it classified the frames
(pages, flow steps, overlays, frames left out) and **waits for your OK**, then reads each
frame, writes the pages and assets, validates the bundle and packs it. Everything lands
in `_work/<file-slug>/`; the zip is written beside it. Attach the zip in Hlou's agent
panel.

You can prepare the file to make the result more faithful — see the layer-name markers
in [`reference/conventions.md`](reference/conventions.md) (`page/home`,
`flow:booking/1`, `overlay/menu`, `@slider`, `@collection:rooms`…). They are hints, never
requirements.

## What is inside

```
.claude-plugin/plugin.json        the plugin manifest (name, version)
skills/hlou-figma-handoff/SKILL.md the procedure Claude follows
reference/                        conventions, section hints, the manifest's JSON Schema,
                                  an example manifest, the icon and Google Fonts lists
scripts/survey.mjs                get_metadata XML → survey.json (frames, flows, overlays,
                                  hidden siblings, vector art, repeated cards)
scripts/validate.mjs              a bundle folder or zip → `code path message` lines
scripts/pack.mjs                  a bundle folder → a deterministic zip (validates first)
scripts/clean-svg.mjs             strips the ancestor backgrounds Figma's SVG exports carry
scripts/spec-target.mjs           the spec target: `detect` a Hlou starter, place a bundle's
                                  `media` under public/media/ (never replacing a file)
reference/spec-target.md          bundle → site spec: what goes where, blocks by section
reference/example-spec/           the contract's minimal fixture, written as a site spec
scripts/refresh-references.mjs    maintainers: regenerate reference/ from the Hlou repo
scripts/*.test.mjs                node --test
```

Check a bundle by hand:

```bash
node scripts/validate.mjs path/to/bundle-or.zip
```

## Develop

```bash
node --test
```

Run from this folder. Inside the Hlou repository the tests also check the scripts
against the contract's own fixtures, the reference files against their sources, that
`reference/example-spec/` (its media placed by `spec-target.mjs`) compiles with the
renderer's own spec compiler, and that the plugin stays brand-neutral (below); in a
published copy those tests skip.

After the bundle contract or the renderer's icon set changes in the Hlou repository:

```bash
node scripts/refresh-references.mjs
```

## Publishing (maintainer, manual)

The plugin is published as is to a public marketplace repository. It carries **no
client data**: no Figma file key or URL, no node id, no client or brand name, no copy,
colour, font choice or asset from a real project. Examples use the contract's minimal
fixture or the invented « Maison Exemple ». `scripts/neutral.test.mjs` enforces it:
it reads every eval bundle in the Hlou repository
(`packages/api/src/evals/agent/__fixtures__/handoff/*/hlou-handoff.json`) and fails if
any file here contains one of their file keys, file names, folder names or node ids.

1. In the Hlou repository, from this folder: `node --test` — every test passes, the
   brand-neutral one included (it must run, not skip).
2. Bump `version` in `.claude-plugin/plugin.json` (and `package.json`): patch for
   wording, minor for a new step or script option, major when the bundle format changes.
   Manifests record it as `generator: "hlou-figma-handoff@<version>"`.
3. Copy this folder into the marketplace repository, replacing the previous copy, without
   `_work/` or any zip:

   ```bash
   rsync -a --delete --exclude _work --exclude '*.zip' ./ <marketplace-repo>/plugins/hlou-figma-handoff/
   ```

4. The marketplace repository holds `.claude-plugin/marketplace.json` listing the plugin:

   ```json
   {
     "name": "<marketplace>",
     "owner": { "name": "EMIKETIC" },
     "plugins": [
       {
         "name": "hlou-figma-handoff",
         "source": "./plugins/hlou-figma-handoff",
         "description": "Turn a Figma design into a Hlou handoff bundle.",
         "version": "<version>"
       }
     ]
   }
   ```

5. Commit and push the marketplace repository; users run `/plugin marketplace update`.

## Licence

MIT.
