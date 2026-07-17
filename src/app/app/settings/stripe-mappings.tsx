'use client';

import { useActionState } from 'react';
import { saveRevenueMapping, deleteRevenueMapping, type ActionState } from '../actions';
import { SubmitButton, Field, ErrorNote, OkNote, Select, TextInput } from '@/components/form';
import { Empty } from '@/components/ui';
import type { Project } from '@/lib/queries';

interface Mapping {
  id: string;
  project_id: string;
  match_type: string;
  match_value: string | null;
}

/**
 * Section 8.1: map a Stripe account/product/price to a project.
 *
 * Without at least one rule, incoming revenue has nowhere to go and is dropped —
 * so this panel says that plainly rather than letting money quietly vanish.
 */
export function StripeMappings({ projects, mappings }: { projects: Project[]; mappings: Mapping[] }) {
  const [state, action] = useActionState<ActionState, FormData>(saveRevenueMapping, {});

  if (projects.length === 0) {
    return <Empty title="Create a project first">Revenue has to land somewhere.</Empty>;
  }

  return (
    <div>
      {mappings.length === 0 ? (
        <p className="border-b border-ink-850 bg-money-500/5 px-4 py-3 text-xs leading-relaxed text-money-400">
          No routing rules yet. Stripe payments will be acknowledged and{' '}
          <strong>discarded</strong> until at least one rule exists — recording money against a
          guessed project would be worse than not recording it.
        </p>
      ) : (
        <ul className="divide-y divide-ink-850/60">
          {mappings.map((m) => {
            const project = projects.find((p) => p.id === m.project_id);
            return (
              <li key={m.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                <div className="min-w-0">
                  <span className="text-ink-300">
                    {m.match_value ? (
                      <>
                        <span className="text-ink-600">{m.match_type}</span>{' '}
                        <code className="font-mono text-xs">{m.match_value}</code>
                      </>
                    ) : (
                      <span className="text-ink-500">everything else</span>
                    )}
                  </span>
                  <span className="mx-2 text-ink-700">→</span>
                  <span className="text-ink-100">{project?.name ?? 'unknown project'}</span>
                </div>
                <DeleteMapping id={m.id} />
              </li>
            );
          })}
        </ul>
      )}

      <form action={action} className="space-y-3 border-t border-ink-850 p-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Match on">
            <Select
              name="match_type"
              defaultValue="account"
              options={[
                { value: 'account', label: 'Account (catch-all)' },
                { value: 'product', label: 'Product' },
                { value: 'price', label: 'Price' },
              ]}
            />
          </Field>
          <Field label="Send to">
            <Select name="project_id" options={projects.map((p) => ({ value: p.id, label: p.name }))} />
          </Field>
        </div>

        <Field
          label="Stripe ID"
          hint="e.g. prod_abc123 or price_abc123. Leave blank with “Account” to route all unmatched revenue here."
        >
          <TextInput name="match_value" placeholder="prod_… / price_… / blank for catch-all" />
        </Field>

        <ErrorNote error={state.error} />
        <OkNote show={state.ok}>Rule saved.</OkNote>

        <SubmitButton variant="ghost">Add rule</SubmitButton>
      </form>
    </div>
  );
}

function DeleteMapping({ id }: { id: string }) {
  const [, action] = useActionState<ActionState, FormData>(deleteRevenueMapping, {});
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <button type="submit" className="shrink-0 text-xs text-ink-700 hover:text-danger-400">
        Remove
      </button>
    </form>
  );
}
