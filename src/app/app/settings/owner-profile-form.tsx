'use client';

import { useActionState } from 'react';
import { updateOwnerProfile, type ActionState } from '../actions';
import { SubmitButton, Field, ErrorNote, OkNote, TextInput, TextArea } from '@/components/form';

export function OwnerProfileForm({
  owner,
}: {
  owner: { public_title?: string; public_bio?: string; display_name?: string };
}) {
  const [state, action] = useActionState<ActionState, FormData>(updateOwnerProfile, {});

  return (
    <form action={action} className="space-y-4 p-4">
      <Field label="Your name" hint="Private — only shown to you.">
        <TextInput name="display_name" defaultValue={owner.display_name ?? ''} placeholder="Alex" />
      </Field>

      <Field label="Public page title">
        <TextInput name="public_title" defaultValue={owner.public_title ?? 'Open Metrics'} placeholder="Open Metrics" />
      </Field>

      <Field label="Intro" hint="A line or two at the top of your stats page. Markdown is not rendered — plain text only.">
        <TextArea
          name="public_bio"
          rows={3}
          defaultValue={owner.public_bio ?? ''}
          placeholder="Everything I'm building, in the open."
        />
      </Field>

      <ErrorNote error={state.error} />
      <OkNote show={state.ok} />

      <SubmitButton>Save</SubmitButton>
    </form>
  );
}
