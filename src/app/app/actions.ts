'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';
import { displayCurrency, parseFxRates, convertMinor, toMinorUnits } from '@/lib/money';
import { parseDomains, slugify, uniqueSlug } from '@/lib/projects';
import { revokeAuthorization } from '@/lib/mcp/oauth';

/**
 * Server actions for the dashboard.
 *
 * All of these run under the owner's session, so RLS is the authority on what
 * they can touch. The validation here is for error messages, not access control.
 */

export interface ActionState {
  error?: string;
  ok?: boolean;
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export async function createProject(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const name = String(formData.get('name') ?? '').trim();
  const domainsRaw = String(formData.get('domains') ?? '').trim();
  const timezone = String(formData.get('timezone') ?? 'UTC');

  if (!name) return { error: 'Give the project a name.' };

  const db = await supabaseServer();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return { error: 'Not signed in.' };

  const domains = parseDomains(domainsRaw);
  const slug = await uniqueSlug(db, slugify(name));
  if (!slug) return { error: 'Could not derive a URL-safe name. Try letters and numbers.' };

  const { error } = await db.from('projects').insert({
    owner_id: user.id,
    name,
    slug,
    domains,
    timezone,
  });

  if (error) return { error: error.message };

  revalidatePath('/app');
  redirect(`/app/p/${slug}?created=1`);
}

export async function updateProject(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = String(formData.get('id') ?? '');
  const db = await supabaseServer();

  const retention = Number(formData.get('retention_days'));
  if (!Number.isFinite(retention) || retention < 1 || retention > 3650) {
    return { error: 'Retention must be between 1 and 3650 days.' };
  }

  const { error } = await db
    .from('projects')
    .update({
      name: String(formData.get('name') ?? '').trim(),
      domains: parseDomains(String(formData.get('domains') ?? '')),
      timezone: String(formData.get('timezone') ?? 'UTC'),
      retention_days: retention,
      bot_filter: String(formData.get('bot_filter') ?? 'standard'),
      excluded_paths: String(formData.get('excluded_paths') ?? '')
        .split(/[\n,]/).map((s) => s.trim()).filter(Boolean),
      respect_dnt: formData.get('respect_dnt') === 'on',
    })
    .eq('id', id);

  if (error) return { error: error.message };

  revalidatePath('/app');
  return { ok: true };
}

/**
 * Rotate the ingest key.
 *
 * Destructive in a way that isn't obvious: every script tag using the old key
 * stops recording the moment this runs, silently, because the collector answers
 * 202 to an unknown key. The UI says so before the click.
 */
export async function rotateKey(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = String(formData.get('id') ?? '');
  const db = await supabaseServer();

  const key = crypto.randomUUID().replace(/-/g, '').slice(0, 24);
  const { error } = await db.from('projects').update({ ingest_key: key }).eq('id', id);

  if (error) return { error: error.message };
  revalidatePath('/app');
  return { ok: true };
}

export async function archiveProject(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = String(formData.get('id') ?? '');
  const archived = formData.get('archived') === 'true';

  const db = await supabaseServer();
  const { error } = await db.from('projects').update({ archived }).eq('id', id);
  if (error) return { error: error.message };

  revalidatePath('/app');
  return { ok: true };
}

/**
 * Permanent delete. Cascades to events, revenue, and rollups via FK.
 * The UI requires typing the project name first.
 */
export async function deleteProject(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = String(formData.get('id') ?? '');
  const confirmation = String(formData.get('confirm') ?? '');
  const expected = String(formData.get('expected') ?? '');

  if (confirmation !== expected) return { error: 'Type the project name exactly to confirm.' };

  const db = await supabaseServer();
  const { error } = await db.from('projects').delete().eq('id', id);
  if (error) return { error: error.message };

  revalidatePath('/app');
  redirect('/app');
}

// ---------------------------------------------------------------------------
// Public page settings
// ---------------------------------------------------------------------------

export async function updatePublicSettings(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const projectId = String(formData.get('project_id') ?? '');
  const db = await supabaseServer();

  const { error } = await db
    .from('project_public_settings')
    .update({
      is_public: formData.get('is_public') === 'on',
      show_visitors: formData.get('show_visitors') === 'on',
      show_pageviews: formData.get('show_pageviews') === 'on',
      show_revenue: formData.get('show_revenue') === 'on',
      show_top_pages: formData.get('show_top_pages') === 'on',
      show_sources: formData.get('show_sources') === 'on',
      show_countries: formData.get('show_countries') === 'on',
      show_live: formData.get('show_live') === 'on',
      number_style: String(formData.get('number_style') ?? 'exact'),
    })
    .eq('project_id', projectId);

  if (error) return { error: error.message };

  revalidatePath('/app');
  revalidatePath('/stats');
  return { ok: true };
}

export async function updateOwnerProfile(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const db = await supabaseServer();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return { error: 'Not signed in.' };

  const { error } = await db
    .from('owners')
    .update({
      public_title: String(formData.get('public_title') ?? '').trim() || 'Open Metrics',
      public_bio: String(formData.get('public_bio') ?? '').trim() || null,
      display_name: String(formData.get('display_name') ?? '').trim() || null,
    })
    .eq('id', user.id);

  if (error) return { error: error.message };

  revalidatePath('/stats');
  revalidatePath('/app/settings');
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Revenue
// ---------------------------------------------------------------------------

/**
 * Manual revenue entry (Section 8.2) — sponsorships, ad payouts, consulting,
 * anything with no API to pull from.
 */
export async function addManualRevenue(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const projectId = String(formData.get('project_id') ?? '');
  const source = String(formData.get('source') ?? 'manual');
  const currency = String(formData.get('currency') ?? 'USD').toUpperCase();
  const amount = Number(formData.get('amount'));
  const isRefund = formData.get('is_refund') === 'on';

  if (!Number.isFinite(amount) || amount === 0) return { error: 'Enter a non-zero amount.' };
  if (!/^[A-Z]{3}$/.test(currency)) return { error: 'Currency must be a 3-letter code, e.g. USD.' };

  const occurredAt = String(formData.get('occurred_at') ?? '');
  const when = occurredAt ? new Date(occurredAt) : new Date();
  if (Number.isNaN(when.getTime())) return { error: 'That date could not be read.' };

  // The form takes a positive number and a "this is a refund" checkbox, because
  // asking a human to type a negative number is a reliable way to get the sign
  // wrong. The sign is applied here, where the DB constraint expects it.
  const magnitude = Math.abs(amount);
  const minor = toMinorUnits(magnitude, currency) * (isRefund ? -1 : 1);

  const base = displayCurrency();
  const db = await supabaseServer();

  const { error } = await db.from('revenue_records').insert({
    project_id: projectId,
    source,
    kind: isRefund ? 'refund' : 'one_time',
    amount_cents: minor,
    currency,
    amount_base_cents: convertMinor({
      amountMinor: minor, from: currency, to: base, rates: parseFxRates(process.env.PULSE_FX_RATES),
    }),
    base_currency: base,
    occurred_at: when.toISOString(),
    label: String(formData.get('label') ?? '').trim() || null,
    note: String(formData.get('note') ?? '').trim() || null,
  });

  if (error) return { error: error.message };

  // The row won't appear in charts until the next rollup, so ask for one now —
  // otherwise a manual entry looks like it silently failed for up to 5 minutes.
  // Errors are ignored: cron will roll it up regardless, and failing the whole
  // action would imply the money wasn't recorded when it was.
  await db.rpc('pulse_rollup_recent');

  revalidatePath('/app');
  return { ok: true };
}

export async function deleteRevenueRecord(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = String(formData.get('id') ?? '');
  const db = await supabaseServer();

  const { error } = await db.from('revenue_records').delete().eq('id', id);
  if (error) return { error: error.message };

  await db.rpc('pulse_rollup_recent');
  revalidatePath('/app');
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------------

export async function createGoal(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const db = await supabaseServer();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return { error: 'Not signed in.' };

  const metric = String(formData.get('metric') ?? 'revenue');
  const rawTarget = Number(formData.get('target'));
  if (!Number.isFinite(rawTarget) || rawTarget <= 0) return { error: 'Target must be greater than zero.' };

  // Money goals are entered in dollars but stored in cents, like every other
  // amount in the system.
  const isMoney = metric === 'revenue' || metric === 'mrr';
  const target = isMoney ? toMinorUnits(rawTarget, displayCurrency()) : Math.round(rawTarget);

  const projectId = String(formData.get('project_id') ?? '');

  const { error } = await db.from('goals').insert({
    owner_id: user.id,
    project_id: projectId || null,
    metric,
    target,
    label: String(formData.get('label') ?? '').trim() || null,
    show_public: formData.get('show_public') === 'on',
  });

  if (error) return { error: error.message };

  revalidatePath('/app');
  revalidatePath('/stats');
  return { ok: true };
}

export async function deleteGoal(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const db = await supabaseServer();
  const { error } = await db.from('goals').delete().eq('id', String(formData.get('id') ?? ''));
  if (error) return { error: error.message };

  revalidatePath('/app');
  revalidatePath('/stats');
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Integrations
// ---------------------------------------------------------------------------

export async function saveRevenueMapping(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const db = await supabaseServer();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return { error: 'Not signed in.' };

  const matchValue = String(formData.get('match_value') ?? '').trim();

  const { error } = await db.from('revenue_mappings').upsert(
    {
      owner_id: user.id,
      project_id: String(formData.get('project_id') ?? ''),
      source: 'stripe',
      match_type: String(formData.get('match_type') ?? 'account'),
      match_value: matchValue || null,
    },
    { onConflict: 'owner_id,source,match_type,match_value' }
  );

  if (error) return { error: error.message };
  revalidatePath('/app/settings');
  return { ok: true };
}

export async function deleteRevenueMapping(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const db = await supabaseServer();
  const { error } = await db.from('revenue_mappings').delete().eq('id', String(formData.get('id') ?? ''));
  if (error) return { error: error.message };
  revalidatePath('/app/settings');
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Connected apps (MCP)
// ---------------------------------------------------------------------------

/**
 * Turn the MCP server on or off for this instance.
 *
 * Off is a pause, not a purge: existing grants keep their rows, so switching
 * back on restores the apps that were already approved rather than making the
 * owner re-authorize each one. What it does do is immediate — discovery starts
 * 404ing and every live token stops working on the next request, because the
 * flag is read per-request rather than cached.
 *
 * Runs under the owner's session so RLS decides whose row this is; the `eq` is
 * for clarity, not for access control.
 */
export async function setMcpEnabled(formData: FormData): Promise<void> {
  const enabled = formData.get('enabled') === 'true';

  const db = await supabaseServer();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return;

  await db.from('owners').update({ mcp_enabled: enabled }).eq('id', user.id);

  revalidatePath('/app/settings');
}

/**
 * Revoke an app's MCP access.
 *
 * Two steps, deliberately in this order. The first update runs under the
 * owner's session, so RLS is what proves the grant belongs to them — the action
 * never asserts ownership itself. Only once the database has confirmed that by
 * returning a row does the second step escalate to service_role to kill the
 * tokens, which live in a table no browser session can reach.
 *
 * Revoking the grant alone would not be enough: a live access token is checked
 * against its authorization on every request, but the refresh token would still
 * be sitting in the client, and leaving dead credentials around invites exactly
 * the kind of "revoked, but still works" bug this feature cannot afford.
 */
export async function disconnectApp(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  if (!id) return;

  const db = await supabaseServer();
  const { data } = await db
    .from('mcp_authorizations')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id)
    .select('id')
    .maybeSingle();

  if (data) await revokeAuthorization(data.id);

  revalidatePath('/app/settings');
}

// ---------------------------------------------------------------------------
// Data controls
// ---------------------------------------------------------------------------

/** One-click purge (Section 11) — honors a deletion request immediately. */
export async function purgeProjectData(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = String(formData.get('project_id') ?? '');
  const confirmation = String(formData.get('confirm') ?? '');
  const expected = String(formData.get('expected') ?? '');

  if (confirmation !== expected) return { error: 'Type the project name exactly to confirm.' };

  const db = await supabaseServer();

  // Raw events only. Rollups survive, so the historical charts stay intact —
  // which is the entire point of separating them.
  const { error } = await db.from('events').delete().eq('project_id', id);
  if (error) return { error: `Could not purge: ${error.message}` };

  revalidatePath('/app');
  return { ok: true };
}

// Slug, domain, and snippet rules live in @/lib/projects so the MCP server can
// apply the identical ones — a 'use server' module can only export async
// functions, so they cannot be shared from here.
