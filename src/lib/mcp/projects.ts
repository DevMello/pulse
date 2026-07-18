import { supabaseAdmin } from '@/lib/supabase/admin';
import { parseDomains, slugify, uniqueSlug } from '@/lib/projects';

/**
 * Project reads and writes for the MCP server.
 *
 * ⚠ Everything in this file runs as `service_role`, which bypasses RLS.
 *
 * That is unavoidable: an MCP request carries a bearer token, not a Supabase
 * session, so there is no `auth.uid()` for a policy to evaluate. The
 * consequence is that the WHERE clause *is* the security boundary here — the
 * one place in Pulse where that is true. Every query below therefore filters on
 * `owner_id`, and every function takes `ownerId` as its first parameter so that
 * omitting it is a type error rather than a silent cross-tenant read.
 *
 * If you add a function here, filter by owner_id. If you are tempted not to,
 * the answer is still filter by owner_id.
 */

export interface McpProject {
  id: string;
  name: string;
  slug: string;
  ingest_key: string;
  domains: string[];
  timezone: string;
  archived: boolean;
  created_at: string;
}

const PROJECT_COLUMNS = 'id, name, slug, ingest_key, domains, timezone, archived, created_at';

export async function listProjects(ownerId: string, includeArchived = false): Promise<McpProject[]> {
  let query = supabaseAdmin()
    .from('projects')
    .select(PROJECT_COLUMNS)
    .eq('owner_id', ownerId)
    .order('created_at', { ascending: false });

  if (!includeArchived) query = query.eq('archived', false);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  return (data ?? []) as McpProject[];
}

export async function getProject(ownerId: string, slug: string): Promise<McpProject | null> {
  const { data, error } = await supabaseAdmin()
    .from('projects')
    .select(PROJECT_COLUMNS)
    .eq('owner_id', ownerId)
    .eq('slug', slug)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as McpProject | null) ?? null;
}

export interface CreateProjectInput {
  name: string;
  domains?: string[];
  timezone?: string;
}

export async function createProject(ownerId: string, input: CreateProjectInput): Promise<McpProject> {
  const db = supabaseAdmin();

  const name = input.name.trim();
  if (!name) throw new Error('Project name cannot be empty.');

  const slug = await uniqueSlug(db, slugify(name));
  if (!slug) {
    throw new Error(
      `Could not derive a URL-safe slug from "${name}". Use a name containing letters or numbers.`
    );
  }

  const { data, error } = await db
    .from('projects')
    .insert({
      owner_id: ownerId,
      name,
      slug,
      domains: parseDomains(input.domains ?? []),
      timezone: input.timezone?.trim() || 'UTC',
    })
    .select(PROJECT_COLUMNS)
    .single();

  if (error) throw new Error(error.message);
  return data as McpProject;
}

/**
 * Replace a project's domain allow-list.
 *
 * The update is scoped by owner_id as well as slug, so a slug guessed from a
 * public stats page cannot be used to edit someone else's project.
 */
export async function updateProjectDomains(
  ownerId: string,
  slug: string,
  domains: string[]
): Promise<McpProject | null> {
  const { data, error } = await supabaseAdmin()
    .from('projects')
    .update({ domains: parseDomains(domains) })
    .eq('owner_id', ownerId)
    .eq('slug', slug)
    .select(PROJECT_COLUMNS)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as McpProject | null) ?? null;
}
