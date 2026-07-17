'use client';

import { useActionState } from 'react';
import { updateProject, type ActionState } from '../../../actions';
import { SubmitButton, Field, ErrorNote, OkNote, Select, TextInput, TextArea, Toggle } from '@/components/form';
import type { Project } from '@/lib/queries';

export function ProjectSettingsForm({ project }: { project: Project }) {
  const [state, action] = useActionState<ActionState, FormData>(updateProject, {});

  return (
    <form action={action} className="space-y-4 p-4">
      <input type="hidden" name="id" value={project.id} />

      <Field label="Name">
        <TextInput name="name" defaultValue={project.name} required />
      </Field>

      <Field label="Domains" hint="Comma-separated. Subdomains included automatically. Blank accepts any origin.">
        <TextInput name="domains" defaultValue={project.domains.join(', ')} placeholder="example.com" />
      </Field>

      <Field label="Timezone" hint="Where your days start and end.">
        <TextInput name="timezone" defaultValue={project.timezone} />
      </Field>

      <Field
        label="Raw event retention"
        hint="Days to keep individual events. Rollups are kept forever, so your charts survive pruning — this only limits realtime and export depth. Shorter is cheaper and more private."
      >
        <Select
          name="retention_days"
          defaultValue={String(project.retention_days)}
          options={[
            { value: '30', label: '30 days' },
            { value: '90', label: '90 days' },
            { value: '180', label: '180 days (default)' },
            { value: '365', label: '1 year' },
            { value: '1095', label: '3 years' },
          ]}
        />
      </Field>

      <Field
        label="Bot filtering"
        hint="Standard catches self-identifying crawlers and link previewers. Strict adds heuristics for bots pretending to be browsers, and will occasionally drop an unusual real visitor."
      >
        <Select
          name="bot_filter"
          defaultValue={project.bot_filter}
          options={[
            { value: 'off', label: 'Off — count everything' },
            { value: 'standard', label: 'Standard (recommended)' },
            { value: 'strict', label: 'Strict' },
          ]}
        />
      </Field>

      <Field label="Excluded paths" hint="One per line. Trailing * matches a prefix, e.g. /admin*">
        <TextArea name="excluded_paths" rows={3} defaultValue={project.excluded_paths.join('\n')} placeholder="/admin*" />
      </Field>

      <Toggle
        name="respect_dnt"
        label="Honor Do Not Track and Global Privacy Control"
        hint="Drops events from browsers signaling either. Pulse collects no personal data either way, so this is a courtesy rather than a legal requirement — and it will lower your numbers."
        defaultChecked={project.respect_dnt}
      />

      <ErrorNote error={state.error} />
      <OkNote show={state.ok} />

      <SubmitButton>Save changes</SubmitButton>
    </form>
  );
}
