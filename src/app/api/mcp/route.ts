import { createMcpHandler, withMcpAuth } from 'mcp-handler';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { z } from 'zod';
import { audienceMatches, hasScope, verifyAccessToken, type Scope } from '@/lib/mcp/oauth';
import { corsPreflight, mcpConfigured, mcpEnabled, originOf, resourceUrl, withCors } from '@/lib/mcp/config';
import { createProject, getProject, listProjects, updateProjectDomains, type McpProject } from '@/lib/mcp/projects';
import { installSnippet, sdkSnippet } from '@/lib/projects';

/**
 * Pulse's MCP server.
 *
 * Lets an AI agent set a project up end to end: create it, read back the ingest
 * key, and hand over the exact script tag to paste. That is the whole remit —
 * the tools here can create and configure projects, and nothing else. There is
 * deliberately no way to delete a project, rotate a key, read visitor data, or
 * touch revenue, because an agent acting on a misread instruction should not be
 * able to cause a loss that the owner cannot undo.
 *
 * Transport is stateless streamable HTTP. SSE is disabled: it is gone from the
 * spec as of 2025-03-26, and mcp-handler's implementation of it needs Redis,
 * which would break Pulse's promise of running on Vercel and Supabase alone.
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Non-secret context threaded from the request onto the token's auth info. */
interface PulseAuthExtra extends Record<string, unknown> {
  ownerId: string;
  origin: string;
}

const handler = createMcpHandler(
  (server) => {
    // -----------------------------------------------------------------------
    // Read
    // -----------------------------------------------------------------------

    server.registerTool(
      'list_projects',
      {
        title: 'List Pulse projects',
        description:
          'List the analytics projects in this Pulse account, with their slug, allowed domains, and timezone. ' +
          'Use this before creating a project to check whether a suitable one already exists. ' +
          'Does not return ingest keys — call get_project_key for the key needed to install the tracker.',
        inputSchema: {
          include_archived: z
            .boolean()
            .optional()
            .describe('Include archived projects. Defaults to false.'),
        },
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      async ({ include_archived }, extra) => {
        const auth = require_(extra.authInfo, 'projects:read');
        const projects = await listProjects(auth.ownerId, include_archived ?? false);

        if (!projects.length) {
          return text(
            'No projects yet. Create one with create_project — you need the project name and the ' +
              'domain(s) the site is served from.'
          );
        }

        return text(
          json({
            count: projects.length,
            projects: projects.map((p) => summarize(p)),
          })
        );
      }
    );

    server.registerTool(
      'get_project_key',
      {
        title: 'Get a project ingest key and install snippet',
        description:
          'Return the ingest key for one project plus ready-to-paste install snippets. ' +
          'This is what you need to finish setting up tracking on a site. ' +
          'The ingest key is public by design — it ships in the page source, and the domain allow-list ' +
          'is what actually prevents spoofed data, so it is safe to write into a repo.',
        inputSchema: {
          slug: z.string().describe('The project slug, as returned by list_projects or create_project.'),
        },
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      async ({ slug }, extra) => {
        const auth = require_(extra.authInfo, 'projects:read');
        const project = await getProject(auth.ownerId, slug);

        if (!project) return failure(`No project with slug "${slug}". Call list_projects to see what exists.`);

        return text(
          json({
            ...summarize(project),
            ingest_key: project.ingest_key,
            install: {
              script_tag: installSnippet(project.ingest_key, auth.origin),
              npm: sdkSnippet(project.ingest_key, auth.origin),
            },
            // Empty domains accepts events from anywhere, which is the single
            // most common misconfiguration. Say so in-band rather than leaving
            // the agent to infer it from an empty array.
            warning: project.domains.length
              ? undefined
              : 'This project has no domain allow-list, so it will accept events from any origin. ' +
                'Call update_project_domains to lock it down.',
          })
        );
      }
    );

    // -----------------------------------------------------------------------
    // Write
    // -----------------------------------------------------------------------

    server.registerTool(
      'create_project',
      {
        title: 'Create a Pulse project',
        description:
          'Create a new analytics project and return its slug, ingest key, and install snippet — ' +
          'everything needed to add tracking to a site in one step. ' +
          'The slug is derived from the name and made unique automatically. ' +
          'Check list_projects first: creating a duplicate project splits a site\'s stats in two.',
        inputSchema: {
          name: z.string().min(1).max(200).describe('Human-readable project name, e.g. "Acme Marketing Site".'),
          domains: z
            .array(z.string())
            .optional()
            .describe(
              'Hostnames allowed to send events, e.g. ["acme.com", "app.acme.com"]. Full URLs and ' +
                '"www." prefixes are normalized away. Strongly recommended: if omitted, the project ' +
                'accepts events from any origin.'
            ),
          timezone: z
            .string()
            .optional()
            .describe('IANA timezone for daily rollups, e.g. "America/New_York". Defaults to UTC.'),
        },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      },
      async ({ name, domains, timezone }, extra) => {
        const auth = require_(extra.authInfo, 'projects:write');

        let project: McpProject;
        try {
          project = await createProject(auth.ownerId, { name, domains, timezone });
        } catch (error) {
          return failure(error instanceof Error ? error.message : 'Could not create the project.');
        }

        return text(
          json({
            created: true,
            ...summarize(project),
            ingest_key: project.ingest_key,
            install: {
              script_tag: installSnippet(project.ingest_key, auth.origin),
              npm: sdkSnippet(project.ingest_key, auth.origin),
            },
            next_step:
              'Paste the script_tag before </body> on the site. Data appears in the dashboard within ' +
              'about five minutes of the first pageview.',
            dashboard_url: `${auth.origin}/app/p/${project.slug}`,
          })
        );
      }
    );

    server.registerTool(
      'update_project_domains',
      {
        title: 'Update a project domain allow-list',
        description:
          'Replace the list of hostnames allowed to send events to a project. ' +
          'This overwrites the existing list rather than adding to it, so include every domain that ' +
          'should keep working — call get_project_key or list_projects first to see the current set. ' +
          'Passing an empty array removes the allow-list entirely and lets any origin send events.',
        inputSchema: {
          slug: z.string().describe('The project slug.'),
          domains: z
            .array(z.string())
            .describe('The complete new list of allowed hostnames. Replaces what is there now.'),
        },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      },
      async ({ slug, domains }, extra) => {
        const auth = require_(extra.authInfo, 'projects:write');

        let project: McpProject | null;
        try {
          project = await updateProjectDomains(auth.ownerId, slug, domains);
        } catch (error) {
          return failure(error instanceof Error ? error.message : 'Could not update the project.');
        }

        if (!project) return failure(`No project with slug "${slug}". Call list_projects to see what exists.`);

        return text(json({ updated: true, ...summarize(project) }));
      }
    );
  },
  {
    serverInfo: { name: 'pulse', version: '1.0.0' },
    instructions:
      'Pulse is a privacy-first web analytics service. These tools set projects up: create a project, ' +
      'read back its ingest key, and configure which domains may send it events. ' +
      'They cannot read analytics data, and they cannot delete or archive anything — direct the user to ' +
      'the Pulse dashboard for those.',
  },
  {
    // No basePath: passing it would derive the endpoint instead of using this
    // value, and "/api/mcp/mcp" is not a URL anyone wants to paste.
    streamableHttpEndpoint: '/api/mcp',
    disableSse: true,
    maxDuration: 60,
    verboseLogs: process.env.NODE_ENV !== 'production',
  }
);

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

/**
 * Turn a bearer token into an MCP AuthInfo, or nothing.
 *
 * Returning undefined (rather than throwing) lets mcp-handler produce the 401
 * with the `WWW-Authenticate: … resource_metadata=…` header that starts the
 * OAuth discovery dance. That header is not a nicety — it is the only thing
 * telling a fresh client where to go to authenticate.
 */
async function verifyToken(req: Request, bearerToken?: string): Promise<AuthInfo | undefined> {
  if (!bearerToken || !mcpConfigured()) return undefined;

  // The owner's MCP toggle is checked inside verifyAccessToken, as part of the
  // query that already joins to their row — so switching it off kills live
  // tokens on the very next request without costing one here.
  const verified = await verifyAccessToken(bearerToken);
  if (!verified) return undefined;

  /**
   * A token explicitly minted for a different resource must not work here, even
   * though it is a row in this same database — see audienceMatches for why that
   * is a real case and not a theoretical one.
   */
  const audience = resourceUrl(req);
  if (!audienceMatches(verified.resource, audience)) return undefined;

  return {
    token: bearerToken,
    clientId: verified.clientId,
    scopes: verified.scope.split(/\s+/).filter(Boolean),
    expiresAt: verified.expiresAt,
    resource: new URL(audience),
    extra: {
      ownerId: verified.ownerId,
      // Captured per request so snippets carry the host the client actually
      // reached — a preview deployment must not hand out production URLs.
      origin: originOf(req),
    } satisfies PulseAuthExtra,
  };
}

// resourceUrl is left unset so the 401's resource_metadata URL is derived from
// the request's own proxy headers — the same origin the client just used, which
// is the only one it can be expected to fetch back.
const authenticated = withMcpAuth(handler, verifyToken, { required: true });

/**
 * Read the owner out of a verified token and check the tool's scope.
 *
 * Trailing underscore because `require` is taken. Throws rather than returning
 * an error result: a tool reaching this point without auth would be a routing
 * bug, and failing loudly beats returning data.
 */
function require_(authInfo: AuthInfo | undefined, scope: Scope): PulseAuthExtra {
  const extra = authInfo?.extra as PulseAuthExtra | undefined;
  if (!authInfo || !extra?.ownerId) throw new Error('Not authenticated.');

  if (!hasScope(authInfo.scopes.join(' '), scope)) {
    throw new Error(
      `This connection was not granted the "${scope}" permission. Reconnect Pulse to approve it.`
    );
  }

  return extra;
}

// ---------------------------------------------------------------------------
// Result helpers
// ---------------------------------------------------------------------------

function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function text(body: string) {
  return { content: [{ type: 'text' as const, text: body }] };
}

/**
 * A failed tool call, reported in-band.
 *
 * `isError` rather than a thrown exception, so the model sees the reason and
 * can correct itself — "no project with that slug" is usually recoverable by
 * calling list_projects, and a transport-level error would deny it that chance.
 */
function failure(message: string) {
  return { content: [{ type: 'text' as const, text: message }], isError: true };
}

function summarize(project: McpProject) {
  return {
    name: project.name,
    slug: project.slug,
    domains: project.domains,
    timezone: project.timezone,
    archived: project.archived,
    created_at: project.created_at,
  };
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

/**
 * The kill switch runs ahead of everything, including auth: an instance with
 * MCP switched off should look like it has no MCP server at all, rather than
 * like one that is merely refusing to talk. 404 rather than 403 for the same
 * reason — there is nothing here to come back and try again against.
 */
async function route(req: Request): Promise<Response> {
  if (!mcpConfigured()) {
    return withCors(
      Response.json(
        {
          error: 'server_error',
          error_description:
            'Pulse MCP requires SUPABASE_SERVICE_ROLE_KEY, which is not set on this deployment.',
        },
        { status: 503 }
      )
    );
  }

  if (!(await mcpEnabled())) {
    return withCors(Response.json({ error: 'not_found' }, { status: 404 }));
  }

  return withCors(await authenticated(req));
}

export { route as GET, route as POST, route as DELETE };

export async function OPTIONS(): Promise<Response> {
  return corsPreflight();
}
