# add-pulse-analytics

An [Agent Skill](https://agentskills.io) that teaches any compatible AI coding tool how
to integrate [Pulse](https://github.com/DevMello/pulse) — self-hosted, cookie-free web
analytics — into an existing web project: pick the right integration path (script tag vs
`@pulse/sdk`), wire it into the project's framework (plain HTML, React, Next.js, Vue,
Svelte/SvelteKit, any SSG), verify events flow, and optionally instrument custom events
and revenue.

The skill is plain Markdown (`SKILL.md` + `references/`) with no tool-specific fields,
so it works in any agent that supports the open Agent Skills format.

## Install

Copy (or symlink) this `add-pulse-analytics/` directory into your tool's skills
location:

| Tool | Location |
|---|---|
| Claude Code (per project) | `.claude/skills/add-pulse-analytics/` |
| Claude Code (personal, all projects) | `~/.claude/skills/add-pulse-analytics/` |
| Cursor | `.cursor/skills/add-pulse-analytics/` |
| OpenAI Codex | `~/.codex/skills/add-pulse-analytics/` |
| Other tools | Wherever the tool documents its skills directory |

Or install it straight from this repo with the
[`skills` CLI](https://github.com/vercel-labs/skills):

```bash
npx skills add DevMello/pulse --skill add-pulse-analytics
```

## Use

In your web project, ask your agent things like:

- "Add Pulse analytics to this site — my instance is at https://pulse.example.com, key `pk_…`"
- "Track pageviews on this Next.js app with Pulse"
- "Instrument signup and purchase events with Pulse revenue tracking"

Have your Pulse deployment origin and the project's public ingest key
(dashboard → Project → Settings) ready — the skill will ask for them if missing.

## Contents

- `SKILL.md` — workflow: gather inputs → detect stack → choose path → apply → verify
- `references/script-tag.md` — `px.js` tag, `data-*` config, `pulse()` global, pre-load stub
- `references/npm-sdk.md` — `@pulse/sdk` install, core API, config, TypeScript types
- `references/frameworks.md` — React, Next.js, Vue, Svelte/SvelteKit adapters
- `references/events-revenue.md` — custom events, revenue rules, recipes, troubleshooting
