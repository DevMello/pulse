'use client';

import { useActionState } from 'react';
import { createProject, type ActionState } from '../actions';
import { SubmitButton, Field, ErrorNote, TextInput } from '@/components/form';

export function NewProjectForm() {
  const [state, action] = useActionState<ActionState, FormData>(createProject, {});

  // The browser knows the user's timezone; asking them to pick it from a list
  // of 400 is a worse default than being right most of the time.
  const guessedTimezone =
    typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC';

  return (
    <form action={action} className="space-y-4 p-4">
      <Field label="Name" hint="Shown in your dashboard and, if you publish it, on your stats page.">
        <TextInput name="name" required autoFocus placeholder="My Side Project" />
      </Field>

      <Field
        label="Domains"
        hint="Only these domains may send events. Subdomains are included automatically. Leave blank to accept any origin — convenient for testing, but anyone who finds your key could then send fake events."
      >
        <TextInput name="domains" placeholder="example.com, blog.example.com" />
      </Field>

      <Field label="Timezone" hint="Determines where your days start and end.">
        <TextInput name="timezone" defaultValue={guessedTimezone} />
      </Field>

      <ErrorNote error={state.error} />

      <SubmitButton>Create project</SubmitButton>
    </form>
  );
}
