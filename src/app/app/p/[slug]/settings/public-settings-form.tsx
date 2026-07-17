'use client';

import { useActionState, useState } from 'react';
import { updatePublicSettings, type ActionState } from '../../../actions';
import { SubmitButton, Field, ErrorNote, OkNote, Select, Toggle } from '@/components/form';
import { CodeBlock } from '@/components/snippet';

interface PublicSettings {
  is_public?: boolean;
  show_visitors?: boolean;
  show_pageviews?: boolean;
  show_revenue?: boolean;
  show_top_pages?: boolean;
  show_sources?: boolean;
  show_countries?: boolean;
  show_live?: boolean;
  number_style?: string;
}

/**
 * Section 10.2: the owner decides exactly what's public, per metric.
 *
 * The toggles gate what the database will serialize, not what the page chooses
 * to render — so "hidden" means the number never leaves Postgres, and cannot be
 * recovered from the network tab.
 */
export function PublicSettingsForm({
  projectId,
  settings,
  slug,
  origin,
}: {
  projectId: string;
  settings: PublicSettings;
  slug: string;
  origin: string;
}) {
  const [state, action] = useActionState<ActionState, FormData>(updatePublicSettings, {});
  const [isPublic, setIsPublic] = useState(Boolean(settings.is_public));
  const [showRevenue, setShowRevenue] = useState(Boolean(settings.show_revenue));

  return (
    <form action={action} className="space-y-4 p-4">
      <input type="hidden" name="project_id" value={projectId} />

      <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border-strong bg-surface-sunken/50 p-3">
        <input
          type="checkbox"
          name="is_public"
          defaultChecked={settings.is_public}
          onChange={(e) => setIsPublic(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-border-strong bg-surface text-brand-500 focus:ring-brand-500"
        />
        <span>
          <span className="block text-sm font-medium text-text">Publish this project</span>
          <span className="mt-0.5 block text-xs text-text-subtle">
            Anyone with the link sees the metrics you allow below. Nothing else.
          </span>
        </span>
      </label>

      <fieldset disabled={!isPublic} className={isPublic ? '' : 'opacity-40'}>
        <legend className="sr-only">Metrics to publish</legend>

        <div className="space-y-0.5">
          <Toggle name="show_visitors" label="Visitors" defaultChecked={settings.show_visitors ?? true} />
          <Toggle name="show_pageviews" label="Pageviews" defaultChecked={settings.show_pageviews ?? true} />
          <Toggle name="show_top_pages" label="Top pages" defaultChecked={settings.show_top_pages ?? true} />
          <Toggle name="show_sources" label="Traffic sources" defaultChecked={settings.show_sources ?? true} />
          <Toggle name="show_countries" label="Countries" defaultChecked={settings.show_countries ?? true} />
          <Toggle name="show_live" label="Live visitor count" defaultChecked={settings.show_live ?? true} />
        </div>

        {/* Genuinely money-toned, unlike the warning banners that used to share
            this token — this block is about publishing income. */}
        <div className="mt-3 rounded-lg border border-money-600/25 bg-money-500/8 p-3">
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              name="show_revenue"
              defaultChecked={settings.show_revenue}
              onChange={(e) => setShowRevenue(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-border-strong bg-surface text-money-600 focus:ring-money-600"
            />
            <span>
              <span className="block text-sm font-medium text-money-700">Revenue</span>
              <span className="mt-0.5 block text-xs text-text-subtle">
                Off by default. This is your income — publishing it is a real decision, not a display
                preference.
              </span>
            </span>
          </label>

          {showRevenue ? (
            <p className="mt-2 border-t border-money-600/20 pt-2 text-xs text-text-subtle">
              Revenue is always shown as an exact figure or not at all — rounding money invites worse
              guesses than the truth. The number style below applies to traffic only.
            </p>
          ) : null}
        </div>

        <div className="mt-4">
          <Field
            label="Number style"
            hint="Applies to traffic metrics. Relative shows only trends — good for proving growth without publishing absolute numbers."
          >
            <Select
              name="number_style"
              defaultValue={settings.number_style ?? 'exact'}
              options={[
                { value: 'exact', label: 'Exact — 12,481' },
                { value: 'rounded', label: 'Rounded — 12,500' },
                { value: 'bucketed', label: 'Bucketed — 10k–25k' },
                { value: 'relative', label: 'Relative — “+18% vs last period”' },
              ]}
            />
          </Field>
        </div>
      </fieldset>

      <ErrorNote error={state.error} />
      <OkNote show={state.ok} />

      <SubmitButton>Save</SubmitButton>

      {isPublic ? (
        <div className="border-t border-border pt-4">
          <p className="mb-2 text-xs font-medium text-text">Embeddable badge</p>
          <p className="mb-2 text-xs text-text-subtle">
            Drop this on your site for a live visitor count. It&apos;s an image, so it works in a README too.
          </p>
          <CodeBlock code={`<img src="${origin}/api/badge/${slug}" alt="Live visitors" height="20">`} />
        </div>
      ) : null}
    </form>
  );
}
