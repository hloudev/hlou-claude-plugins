# Hlou Claude Code plugins

Claude Code plugins for building websites with Hlou.

## Install

In Claude Code:

```text
/plugin marketplace add hloudev/hlou-claude-plugins
/plugin install hlou-figma-handoff@hlou-claude-plugins
```

Update later with `/plugin marketplace update hlou-claude-plugins`.

## Plugins

| Plugin | What it does |
|---|---|
| [`hlou-figma-handoff`](plugins/hlou-figma-handoff/README.md) | Turns a Figma design into a « Hlou handoff bundle » — a `.zip` of pages, assets and a manifest that Hlou's agent builds a site from. Needs Figma's MCP server connected in Claude Code and Node.js 20+. |

### hlou-figma-handoff in one minute

1. Connect Figma's MCP server in Claude Code (the remote server or the Figma desktop app's).
2. Ask Claude Code: « Prepare this Figma file for Hlou: https://www.figma.com/design/… »
3. Check how it classified the frames (pages, flow steps, overlays) and confirm.
4. Attach the zip it writes in Hlou's agent panel, in Design.

Layer-name markers (`page/home`, `flow:booking/1`, `overlay/menu`, `@slider`,
`@collection:rooms`…) make the result more faithful; see
[`conventions.md`](plugins/hlou-figma-handoff/reference/conventions.md).

## Licence

MIT.
