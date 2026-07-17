import { notFound } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';
import {
  getProjectBySlug, getSeries, getBreakdown, sumTotals, resolveRange,
  previousRange, pctChange, fillSeries, getRevenueRecords, getMrr,
} from '@/lib/queries';
import { Card, CardHeader, Stat, Sparkline, BarList, Empty, Badge } from '@/components/ui';
import { RangePicker } from '@/components/range-picker';
import { formatMoney, formatMoneyCompact, displayCurrency } from '@/lib/money';
import { ManualRevenueForm } from './manual-revenue-form';
import { DeleteRevenueButton } from './delete-revenue-button';

export default async function RevenuePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ range?: string }>;
}) {
  const { slug } = await params;
  const { range: rangeKey = '30d' } = await searchParams;

  const db = await supabaseServer();
  const project = await getProjectBySlug(db, slug);
  if (!project) notFound();

  const range = resolveRange(rangeKey);
  const prev = previousRange(range);
  const ids = [project.id];
  const currency = displayCurrency();

  const [series, prevSeries, bySource, records, mrr] = await Promise.all([
    getSeries(db, ids, range),
    getSeries(db, ids, prev),
    getBreakdown(db, ids, 'revenue_source', range, 10),
    getRevenueRecords(db, ids, range, 50),
    getMrr(db, ids),
  ]);

  const totals = sumTotals(series);
  const prevTotals = sumTotals(prevSeries);
  const filled = fillSeries(series, range);

  // Revenue per visitor: the number that tells you whether traffic is worth
  // anything. Guarded because dividing by zero visitors is a very common state
  // for a new project.
  const rpv = totals.visitors > 0 ? totals.revenue_cents / totals.visitors : null;

  // Currencies present that we have no rate for — their money is in the total
  // unconverted, which we must say rather than quietly misreport.
  const rates = process.env.PULSE_FX_RATES;
  const unconverted = [...new Set(records.filter((r) => r.currency !== r.base_currency).map((r) => r.currency))]
    .filter((c) => !rates || !rates.includes(c));

  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        <RangePicker current={rangeKey} />
      </div>

      <Card>
        <div className="grid grid-cols-2 divide-border sm:grid-cols-4 sm:divide-x">
          <Stat
            label="Revenue"
            value={formatMoneyCompact(totals.revenue_cents, currency)}
            delta={pctChange(prevTotals.revenue_cents, totals.revenue_cents)}
            hint="net of refunds"
            accent="money"
          />
          <Stat label="MRR" value={formatMoneyCompact(mrr, currency)} hint="active subs, monthly rate" accent="money" />
          <Stat
            label="Per visitor"
            value={rpv === null ? '—' : formatMoney(Math.round(rpv), currency)}
            hint="revenue ÷ visitors"
            accent="money"
          />
          <Stat label="Transactions" value={String(records.length)} hint={`in ${range.label.toLowerCase()}`} />
        </div>
        <div className="border-t border-border px-1 pt-2 pb-1">
          <Sparkline
            points={filled.map((p) => p.revenue_cents)}
            height={90}
            stroke="var(--color-money-500)"
            fill="var(--color-money-500)"
            label={`Revenue, ${range.label}`}
          />
        </div>
      </Card>

      {unconverted.length > 0 ? (
        <div className="rounded-lg border border-warn-600/25 bg-warn-500/8 px-4 py-3 text-xs text-warn-700">
          No exchange rate configured for {unconverted.join(', ')}. Those amounts are counted at face
          value in the {currency} total, which overstates or understates it. Set{' '}
          <code className="font-mono">PULSE_FX_RATES</code> to fix.
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardHeader title="By source" subtitle="Stripe, SDK, manual, ads, affiliates" />
          <BarList
            items={bySource.map((s) => ({
              label: titleCase(s.value),
              value: s.revenue_cents,
              display: formatMoneyCompact(s.revenue_cents, currency),
            }))}
            emptyMessage="No revenue recorded in this range."
          />
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader title="Add revenue by hand" subtitle="Sponsorships, ad payouts, consulting — anything with no API" />
          <ManualRevenueForm projectId={project.id} defaultCurrency={currency} />
        </Card>
      </div>

      <Card>
        <CardHeader title="Transactions" subtitle={range.label} />
        {records.length === 0 ? (
          <Empty title="Nothing yet">
            <p>
              Connect Stripe in settings, send revenue from the SDK, or add an entry above.
            </p>
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-text-subtle">
                  <th className="px-4 py-2 font-medium">When</th>
                  <th className="px-4 py-2 font-medium">Source</th>
                  <th className="px-4 py-2 font-medium">Kind</th>
                  <th className="px-4 py-2 text-right font-medium">Amount</th>
                  <th className="px-4 py-2 text-right font-medium">In {currency}</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {records.map((r) => (
                  <tr key={r.id} className="text-text">
                    <td className="px-4 py-2 whitespace-nowrap text-text-subtle">
                      {new Date(r.occurred_at).toLocaleDateString(undefined, {
                        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                      })}
                    </td>
                    <td className="px-4 py-2">
                      {r.label ?? titleCase(r.source)}
                      {r.note ? <span className="ml-2 text-xs text-text-subtle">{r.note}</span> : null}
                    </td>
                    <td className="px-4 py-2">
                      <Badge tone={r.amount_cents < 0 ? 'warn' : r.kind === 'subscription' ? 'good' : 'neutral'}>
                        {r.kind.replace('_', ' ')}
                      </Badge>
                    </td>
                    <td className={`nums px-4 py-2 text-right ${r.amount_cents < 0 ? 'text-danger-600' : 'text-text'}`}>
                      {formatMoney(r.amount_cents, r.currency)}
                    </td>
                    <td className="nums px-4 py-2 text-right text-text-subtle">
                      {r.currency === r.base_currency ? '—' : formatMoney(r.amount_base_cents, r.base_currency)}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {/* Stripe rows are reconstructable from a webhook replay;
                          manual ones are not, so only manual ones are deletable
                          here to avoid a delete that a redelivery silently undoes. */}
                      {r.source === 'stripe' ? null : <DeleteRevenueButton id={r.id} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
