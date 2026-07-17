'use client';

import { useActionState } from 'react';
import { deleteRevenueRecord, type ActionState } from '../../../actions';

export function DeleteRevenueButton({ id }: { id: string }) {
  const [state, action] = useActionState<ActionState, FormData>(deleteRevenueRecord, {});

  return (
    <form action={action} className="inline">
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        className="text-xs text-ink-700 transition hover:text-danger-400"
        title={state.error ?? 'Delete this entry'}
      >
        Delete
      </button>
    </form>
  );
}
