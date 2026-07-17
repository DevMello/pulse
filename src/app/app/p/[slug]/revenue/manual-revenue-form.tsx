'use client';

import { useActionState } from 'react';
import { addManualRevenue, type ActionState } from '../../../actions';
import { SubmitButton, Field, ErrorNote, OkNote, Select, TextInput, Toggle } from '@/components/form';

/** Section 8.2: labeled sources for income with no API to pull from. */
const SOURCES = [
  { value: 'manual', label: 'Manual / other' },
  { value: 'ads', label: 'Ad network' },
  { value: 'affiliate', label: 'Affiliate payout' },
  { value: 'sponsorship', label: 'Sponsorship' },
  { value: 'paddle', label: 'Paddle' },
  { value: 'lemonsqueezy', label: 'Lemon Squeezy' },
];

export function ManualRevenueForm({
  projectId,
  defaultCurrency,
}: {
  projectId: string;
  defaultCurrency: string;
}) {
  const [state, action] = useActionState<ActionState, FormData>(addManualRevenue, {});

  return (
    <form action={action} className="space-y-3 p-4">
      <input type="hidden" name="project_id" value={projectId} />

      <div className="grid grid-cols-2 gap-3">
        <Field label="Amount">
          {/* step=0.01 rather than a free text field: it gets the numeric keypad
              on mobile and rejects "twenty dollars" before it reaches the server. */}
          <TextInput name="amount" type="number" step="0.01" min="0" required placeholder="250.00" />
        </Field>
        <Field label="Currency">
          <TextInput
            name="currency"
            defaultValue={defaultCurrency}
            maxLength={3}
            pattern="[A-Za-z]{3}"
            className="uppercase"
          />
        </Field>
      </div>

      <Field label="Source">
        <Select name="source" options={SOURCES} defaultValue="manual" />
      </Field>

      <Field label="Label" hint="Groups this with similar income on charts, e.g. “Carbon Ads”.">
        <TextInput name="label" placeholder="Carbon Ads" />
      </Field>

      <Field label="When" hint="Leave blank for now.">
        <TextInput name="occurred_at" type="datetime-local" />
      </Field>

      <Field label="Note">
        <TextInput name="note" placeholder="March payout" />
      </Field>

      {/* A checkbox rather than asking for a negative number: people get the
          sign wrong, and a wrong sign silently inflates a public figure. */}
      <Toggle name="is_refund" label="This is a refund or payout reversal" hint="Recorded as a negative amount." />

      <ErrorNote error={state.error} />
      <OkNote show={state.ok}>Recorded.</OkNote>

      <SubmitButton>Add revenue</SubmitButton>
    </form>
  );
}
