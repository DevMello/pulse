import type { Metadata } from 'next';
import { NewProjectForm } from './new-project-form';
import { Card, CardHeader } from '@/components/ui';

export const metadata: Metadata = { title: 'New project' };

export default function NewProjectPage() {
  return (
    <div className="mx-auto max-w-lg py-8">
      <h1 className="mb-1 text-xl font-semibold text-ink-50">New project</h1>
      <p className="mb-6 text-sm text-ink-500">
        One project per site or app. You&apos;ll get the snippet on the next screen.
      </p>

      <Card>
        <CardHeader title="Details" />
        <NewProjectForm />
      </Card>
    </div>
  );
}
