'use client';

import { useActionState, useState } from 'react';
import { createGoal, deleteGoal, type ActionState } from '../actions';
import { SubmitButton, Field, ErrorNote, OkNote, Select, TextInput, Toggle } from '@/components/form';
import { Badge } from '@/components/ui';
import type { Project, Goal } from '@/lib/queries';
import { formatMoney } from '@/lib/money';

export function GoalsPanel({
  projects,
  goals,
  currency,
}: {
  projects: Project[];
  goals: Goal[];
  currency: string;
}) {
  const [state, action] = useActionState<ActionState, FormData>(createGoal, {});
  const [metric, setMetric] = useState('revenue');
  const isMoney = metric === 'revenue' || metric === 'mrr';

  return (
    <div className="grid gap-0 md:grid-cols-2 md:divide-x md:divide-ink-850">
      <div>
        {goals.length === 0 ? (
          <p className="px-4 py-6 text-sm text-ink-600">
            No goals yet. A goal gives the public page a milestone to celebrate — “$1k MRR reached 🎉”.
          </p>
        ) : (
          <ul className="divide-y divide-ink-850/60">
            {goals.map((g) => {
              const money = g.metric === 'revenue' || g.metric === 'mrr';
              const project = projects.find((p) => p.id === g.project_id);
              return (
                <li key={g.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm text-ink-200">{g.label ?? g.metric}</span>
                      {g.achieved_at ? <Badge tone="good">reached</Badge> : null}
                      {g.show_public ? <Badge>public</Badge> : null}
                    </div>
                    <div className="mt-0.5 text-xs text-ink-600">
                      {money ? formatMoney(g.target, currency) : g.target.toLocaleString()} {g.metric}
                      {project ? ` · ${project.name}` : ' · all projects'}
                    </div>
                  </div>
                  <DeleteGoal id={g.id} />
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <form action={action} className="space-y-3 border-t border-ink-850 p-4 md:border-t-0">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Metric">
            <select
              name="metric"
              value={metric}
              onChange={(e) => setMetric(e.target.value)}
              className="w-full rounded-lg border border-ink-800 bg-ink-900 px-3 py-2 text-sm text-ink-100 focus:border-pulse-600 focus:outline-none"
            >
              <option value="revenue">Revenue (total)</option>
              <option value="mrr">MRR</option>
              <option value="visitors">Visitors</option>
              <option value="pageviews">Pageviews</option>
            </select>
          </Field>

          <Field label={isMoney ? `Target (${currency})` : 'Target'}>
            <TextInput
              name="target"
              type="number"
              min="1"
              step={isMoney ? '0.01' : '1'}
              required
              placeholder={isMoney ? '1000' : '10000'}
            />
          </Field>
        </div>

        <Field label="Project">
          <Select
            name="project_id"
            options={[{ value: '', label: 'All projects (portfolio)' }, ...projects.map((p) => ({ value: p.id, label: p.name }))]}
          />
        </Field>

        <Field label="Label" hint="What the milestone says when reached.">
          <TextInput name="label" placeholder="$1k MRR" />
        </Field>

        <Toggle
          name="show_public"
          label="Show on the public page"
          hint="Displays the milestone. The underlying number still obeys that project's revenue toggle."
        />

        <ErrorNote error={state.error} />
        <OkNote show={state.ok}>Goal added.</OkNote>

        <SubmitButton variant="ghost">Add goal</SubmitButton>
      </form>
    </div>
  );
}

function DeleteGoal({ id }: { id: string }) {
  const [, action] = useActionState<ActionState, FormData>(deleteGoal, {});
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <button type="submit" className="shrink-0 text-xs text-ink-700 hover:text-danger-400">
        Remove
      </button>
    </form>
  );
}
