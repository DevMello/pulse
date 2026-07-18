# Provisioning through the Pulse MCP server

Every Pulse instance serves an MCP server at `https://<host>/api/mcp` (Streamable HTTP,
OAuth 2.1 — it's on by default; the owner can disable it in the dashboard). When the
user has connected it, you can create the project and read back the ingest key yourself
instead of sending them to the dashboard. The tools are scoped to **setup only**.

## Detect and validate

Look through your available tools for these four, from a server named `pulse` (most
clients prefix tool names with the server name, e.g. `mcp__pulse__list_projects`):

| Tool | Does |
|---|---|
| `list_projects` | Name, slug, domains, timezone, archived flag for every project. No keys. |
| `get_project_key` | One project's ingest key plus ready-made install snippets. |
| `create_project` | Creates a project; returns slug, ingest key, snippets, dashboard URL. |
| `update_project_domains` | **Replaces** a project's domain allow-list. |

Validate with a single `list_projects` call before relying on the server. Two failure
modes, both recoverable:

- **Auth/scope error** (e.g. `This connection was not granted the "projects:read"
  permission. Reconnect Pulse to approve it.`) — tell the user to reconnect/re-approve
  the Pulse connector in their client, and fall back to asking for the key and host
  manually. Don't try to drive the OAuth flow yourself.
- **Tool errors are returned in-band** (as error text, not transport failures) and
  usually say how to recover — e.g. a bad slug suggests calling `list_projects`.

If the tools aren't present at all, just use the manual path from SKILL.md Step 1. If
the user seems interested, they can connect the server later: in Claude Code it's
`claude mcp add --transport http pulse https://<host>/api/mcp`; in Claude/ChatGPT it's a
custom connector pointing at that URL.

## Find or create the project

**Always `list_projects` first.** Match the site you're integrating against each
project's `domains` (and name). Creating a duplicate project for a site that already has
one splits its stats in two — the tool descriptions warn about this for good reason.

- **Match found** → `get_project_key({ slug })`. Returns the project summary plus
  `ingest_key` and `install.script_tag` / `install.npm`. If the project has no domain
  allow-list, the response carries a `warning` — surface it and offer to fix it (below).
- **No match** → confirm with the user before creating (it's a write to their account,
  and the right project name/domains are theirs to choose), then:

```
create_project({
  name: "Acme Marketing Site",          // human-readable; slug is derived + uniqued
  domains: ["acme.com", "app.acme.com"], // strongly recommended — omitting it accepts
                                         // events from ANY origin
  timezone: "America/New_York"           // IANA, optional, defaults to UTC
})
```

Domains are normalized server-side (`https://www.Acme.com/pricing` → `acme.com`), so
pass what the user gave you. The response includes `created: true`, the summary,
`ingest_key`, both install snippets, a `dashboard_url`, and a `next_step` hint.

## Extract the host

Tool results don't include a bare host field — take the origin from the returned
`install.script_tag` (`src="https://<host>/px.js"`) or `dashboard_url`. That origin is
the `host` for `init()` and the script `src`, and it's the origin the user's client
actually reached, so it's the right one even on preview deployments.

## Use the snippets as data, not as the integration

`install.script_tag` is paste-ready and authoritative for the key + host values. But
`install.npm` is a generic core-SDK example — it doesn't know the project's framework.
Prefer the framework-appropriate patterns in [frameworks.md](frameworks.md) and
[npm-sdk.md](npm-sdk.md), using the key and host you extracted.

## Keep the allow-list right

`update_project_domains({ slug, domains })` **replaces** the whole list — read the
current set (via `list_projects` or `get_project_key`) and send the complete new list,
including every domain that should keep working. An empty array removes the allow-list
entirely, letting any origin send events — never send `[]` unless the user explicitly
asks for an open project.

After the integration lands, make sure the production domain is in the list. And when
verifying from `localhost`, remember the allow-list is enforced server-side: a rejected
event still returns `202`, so a local test event may not reach the dashboard until the
site runs on an allow-listed domain — code-level verification (the `/api/event` request
firing with a `202`) is the meaningful local check.

## What the server deliberately can't do

No deleting or archiving projects, no key rotation, no reading analytics or revenue
data, no public-page changes. Those live in the dashboard, where a human does them on
purpose — direct the user there instead of looking for a workaround. The ingest keys the
tools return are public by design and safe to write into the repo.
