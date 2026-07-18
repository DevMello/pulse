import { SubmitButton } from '@/components/form';
import { disconnectApp, setMcpEnabled } from '../actions';

/**
 * Apps connected over MCP, the switch that turns the whole feature off, and the
 * button that cuts one app off.
 *
 * The revoke path is the reason this panel exists. An OAuth grant is a standing
 * permission that outlives the conversation that created it, so there has to be
 * somewhere obvious to end one — and it has to be a single click, because a
 * revocation someone puts off is a revocation that does not happen. The master
 * switch sits in the same place for the same reason: the moment you want it is
 * the moment you are looking at a list of apps and don't like what you see.
 */

export interface ConnectedApp {
  id: string;
  client_name: string;
  scope: string;
  created_at: string;
  last_used_at: string | null;
}

export function ConnectedApps({
  apps,
  enabled,
  configured,
}: {
  apps: ConnectedApp[];
  enabled: boolean;
  configured: boolean;
}) {
  // A missing service role key is not something the toggle can fix, so say that
  // instead of offering a switch that would do nothing.
  if (!configured) {
    return (
      <div className="p-4 text-xs leading-relaxed text-text-subtle">
        <p>
          MCP needs <code className="font-mono text-text-muted">SUPABASE_SERVICE_ROLE_KEY</code> set on
          this deployment. It&apos;s the same key ingestion uses — see{' '}
          <code className="font-mono text-text-muted">.env.example</code>.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="flex items-start justify-between gap-4 border-b border-border p-4">
        <div className="min-w-0">
          <div className="text-sm font-medium text-text">
            {enabled ? 'Assistants can connect' : 'Connections are paused'}
          </div>
          <p className="mt-0.5 text-xs leading-relaxed text-text-subtle">
            {enabled
              ? 'Approved apps can create projects and read ingest keys. They can never see your analytics, revenue, or password.'
              : 'Nothing can connect or use an existing connection. Your approved apps are kept, so turning this back on restores them.'}
          </p>
        </div>

        <form action={setMcpEnabled} className="shrink-0">
          <input type="hidden" name="enabled" value={enabled ? 'false' : 'true'} />
          <SubmitButton variant={enabled ? 'danger' : 'primary'}>
            {enabled ? 'Turn off' : 'Turn on'}
          </SubmitButton>
        </form>
      </div>

      {!apps.length ? (
        <div className="p-4 text-xs leading-relaxed text-text-subtle">
          <p>No apps connected yet.</p>
          <p className="mt-1.5">
            Add Pulse as a connector in Claude or ChatGPT using the endpoint below, and you&apos;ll be
            asked to approve it here first.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {apps.map((app) => (
            <li key={app.id} className="flex items-center justify-between gap-4 px-4 py-3">
              <div className="min-w-0">
                {/* Self-declared at registration and never verified, so it is
                    shown as plain text and nothing is inferred from it. */}
                <div className="truncate text-sm font-medium text-text">{app.client_name}</div>
                <div className="mt-0.5 text-xs text-text-subtle">
                  Connected {formatDate(app.created_at)}
                  {app.last_used_at ? ` · last used ${formatDate(app.last_used_at)}` : ' · never used'}
                </div>
              </div>

              <form action={disconnectApp}>
                <input type="hidden" name="id" value={app.id} />
                <SubmitButton variant="danger">Disconnect</SubmitButton>
              </form>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
