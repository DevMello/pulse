/**
 * Section 10.4: the trust note.
 *
 * The point of this section is that it admits things. A methodology note that
 * only lists strengths is marketing, and readers can tell. Stating where the
 * numbers are soft — NAT collisions, multi-device double counting, MRR being a
 * proxy — is what makes the rest of the page believable.
 */
export function Methodology() {
  return (
    <section className="mt-12 rounded-xl border border-ink-850 bg-ink-900/30 p-5">
      <h2 className="text-sm font-medium text-ink-200">How these numbers are measured</h2>

      <dl className="mt-4 grid gap-4 sm:grid-cols-2">
        <Item term="No cookies, no tracking">
          Visitors are counted with a salted hash of coarse signals that is regenerated every day and
          destroyed within 48 hours. Nobody — including the owner of this database — can link a
          visitor across two days, or across two of these sites. No personal data is collected and
          no IP address is stored.
        </Item>

        <Item term="What “visitors” means">
          Unique visitors <em>per day</em>, summed over the range. Somebody who visits on Monday and
          Tuesday counts twice, because deliberately nothing links those two days together. Over a
          multi-day range this is closer to “visits” than to “people”.
        </Item>

        <Item term="Where it's imprecise">
          Two people on one network with identical devices count once. One person on a phone and a
          laptop counts twice. These are the direct cost of not tracking anyone, and the trade is
          intentional.
        </Item>

        <Item term="Bots are excluded">
          Crawlers, link previewers, uptime monitors, AI scrapers, and HTTP libraries are filtered
          out before anything is recorded. A link pasted into a big Slack does not become a traffic
          spike here.
        </Item>

        <Item term="Revenue is net">
          Refunds and lost disputes are subtracted, not hidden. Figures are shown in the display
          currency; amounts charged in other currencies are converted at a fixed rate, so combined
          totals are approximate by a percent or two.
        </Item>

        <Item term="MRR is a proxy">
          It's the trailing 30 days of subscription payments, not a projection from subscription
          records. An annual plan lands entirely in the month it was billed rather than being spread
          across twelve.
        </Item>
      </dl>

      <p className="mt-4 border-t border-ink-850 pt-3 text-xs leading-relaxed text-ink-600">
        The owner chooses which metrics appear here. Anything hidden is never sent to your browser —
        it isn't rendered invisibly or fetched and discarded. Everything shown comes from
        pre-aggregated summaries; no individual event or visitor is ever exposed.
      </p>
    </section>
  );
}

function Item({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium text-ink-300">{term}</dt>
      <dd className="mt-1 text-xs leading-relaxed text-ink-600">{children}</dd>
    </div>
  );
}
