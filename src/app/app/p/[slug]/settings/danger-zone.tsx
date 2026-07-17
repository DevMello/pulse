'use client';

import { useActionState, useState } from 'react';
import { rotateKey, archiveProject, deleteProject, purgeProjectData, type ActionState } from '../../../actions';
import { SubmitButton, ErrorNote, OkNote, TextInput } from '@/components/form';
import type { Project } from '@/lib/queries';

/**
 * Irreversible things.
 *
 * Each one states its actual consequence rather than "are you sure?", and the
 * two that destroy data require typing the project name. The rotate-key case is
 * the sneaky one: it fails *silently* on the visitor's side, so it gets the
 * loudest warning even though it deletes nothing.
 */
export function DangerZone({ project }: { project: Project }) {
  return (
    <div className="divide-y divide-ink-850">
      <RotateKey project={project} />
      <ArchiveToggle project={project} />
      <PurgeData project={project} />
      <DeleteProject project={project} />
    </div>
  );
}

function RotateKey({ project }: { project: Project }) {
  const [state, action] = useActionState<ActionState, FormData>(rotateKey, {});
  const [armed, setArmed] = useState(false);

  return (
    <div className="p-4">
      <h3 className="text-sm font-medium text-ink-200">Rotate ingest key</h3>
      <p className="mt-1 text-xs leading-relaxed text-ink-600">
        Issues a new key and invalidates the current one. Every site still using the old snippet
        stops recording immediately and <strong className="text-ink-400">without any error</strong> —
        the collector ignores unknown keys on purpose. Update your snippet everywhere first.
      </p>

      {armed ? (
        <form action={action} className="mt-3 flex items-center gap-2">
          <input type="hidden" name="id" value={project.id} />
          <SubmitButton variant="danger">Rotate now</SubmitButton>
          <button type="button" onClick={() => setArmed(false)} className="text-xs text-ink-500 hover:text-ink-300">
            Cancel
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setArmed(true)}
          className="mt-3 rounded-lg border border-ink-800 bg-ink-850 px-3 py-1.5 text-xs text-ink-300 hover:bg-ink-800"
        >
          Rotate key
        </button>
      )}

      <ErrorNote error={state.error} />
      <OkNote show={state.ok}>Key rotated. Update your snippet now — the old one is dead.</OkNote>
    </div>
  );
}

function ArchiveToggle({ project }: { project: Project }) {
  const [state, action] = useActionState<ActionState, FormData>(archiveProject, {});

  return (
    <form action={action} className="p-4">
      <input type="hidden" name="id" value={project.id} />
      <input type="hidden" name="archived" value={String(!project.archived)} />

      <h3 className="text-sm font-medium text-ink-200">{project.archived ? 'Unarchive' : 'Archive'}</h3>
      <p className="mt-1 text-xs leading-relaxed text-ink-600">
        {project.archived
          ? 'Restore this project to your dashboard and resume collecting events.'
          : 'Hides the project and stops accepting new events. Existing data is untouched and you can undo this at any time.'}
      </p>

      <div className="mt-3">
        <SubmitButton variant="ghost">{project.archived ? 'Unarchive' : 'Archive'}</SubmitButton>
      </div>
      <ErrorNote error={state.error} />
    </form>
  );
}

function PurgeData({ project }: { project: Project }) {
  const [state, action] = useActionState<ActionState, FormData>(purgeProjectData, {});
  const [armed, setArmed] = useState(false);

  return (
    <div className="p-4">
      <h3 className="text-sm font-medium text-ink-200">Purge raw events</h3>
      <p className="mt-1 text-xs leading-relaxed text-ink-600">
        Deletes every individual event row for this project. Your rollups survive, so charts and
        totals stay intact — only realtime and export lose their depth. Useful for honoring a
        deletion request or reclaiming storage.
      </p>

      {armed ? (
        <form action={action} className="mt-3 space-y-2">
          <input type="hidden" name="project_id" value={project.id} />
          <input type="hidden" name="expected" value={project.name} />
          <TextInput name="confirm" placeholder={`Type “${project.name}” to confirm`} autoComplete="off" />
          <div className="flex items-center gap-2">
            <SubmitButton variant="danger">Purge events</SubmitButton>
            <button type="button" onClick={() => setArmed(false)} className="text-xs text-ink-500 hover:text-ink-300">
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setArmed(true)}
          className="mt-3 rounded-lg border border-ink-800 bg-ink-850 px-3 py-1.5 text-xs text-ink-300 hover:bg-ink-800"
        >
          Purge raw events
        </button>
      )}

      <ErrorNote error={state.error} />
      <OkNote show={state.ok}>Raw events purged. Rollups and charts are unaffected.</OkNote>
    </div>
  );
}

function DeleteProject({ project }: { project: Project }) {
  const [state, action] = useActionState<ActionState, FormData>(deleteProject, {});
  const [armed, setArmed] = useState(false);

  return (
    <div className="p-4">
      <h3 className="text-sm font-medium text-danger-400">Delete project</h3>
      <p className="mt-1 text-xs leading-relaxed text-ink-600">
        Removes the project and everything attached to it — events, revenue records, rollups, and
        history. There is no undo and no backup. Archiving is almost always what you want instead.
      </p>

      {armed ? (
        <form action={action} className="mt-3 space-y-2">
          <input type="hidden" name="id" value={project.id} />
          <input type="hidden" name="expected" value={project.name} />
          <TextInput name="confirm" placeholder={`Type “${project.name}” to confirm`} autoComplete="off" />
          <div className="flex items-center gap-2">
            <SubmitButton variant="danger">Delete permanently</SubmitButton>
            <button type="button" onClick={() => setArmed(false)} className="text-xs text-ink-500 hover:text-ink-300">
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setArmed(true)}
          className="mt-3 rounded-lg border border-danger-500/30 bg-danger-500/5 px-3 py-1.5 text-xs text-danger-400 hover:bg-danger-500/10"
        >
          Delete project
        </button>
      )}

      <ErrorNote error={state.error} />
    </div>
  );
}
