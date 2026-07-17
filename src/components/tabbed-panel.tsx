'use client';

import { useRef, useState, type ReactNode } from 'react';

/**
 * The tabbed breakdown panel — Sources, Pages, Locations, Devices, Behaviours.
 *
 * Every tab's content is rendered on the server and handed over as a ReactNode,
 * so switching is instant and costs no request. That's affordable because a tab
 * is 8–12 rows: the whole panel is smaller than the spinner a fetch-on-click
 * version would need. It also means the tabs work identically before hydration.
 *
 * The trade is that all tabs are in the RSC payload whether or not they're
 * opened. At this row count that's the right side of the trade; it would not be
 * if a tab grew into a table of hundreds.
 */

export interface Tab {
  key: string;
  label: string;
  content: ReactNode;
}

export function TabbedPanel({
  tabs,
  title,
  action,
  className = '',
}: {
  tabs: Tab[];
  title?: string;
  action?: ReactNode;
  className?: string;
}) {
  const [active, setActive] = useState(0);
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const visible = tabs.filter(Boolean);
  if (visible.length === 0) return null;

  const current = visible[Math.min(active, visible.length - 1)];

  // Arrow-key navigation is expected of a tablist and is the difference between
  // this being reachable by keyboard and merely being focusable.
  function onKeyDown(e: React.KeyboardEvent) {
    const last = visible.length - 1;
    let next: number | null = null;

    if (e.key === 'ArrowRight') next = active === last ? 0 : active + 1;
    else if (e.key === 'ArrowLeft') next = active === 0 ? last : active - 1;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = last;

    if (next !== null) {
      e.preventDefault();
      setActive(next);
      refs.current[next]?.focus();
    }
  }

  // min-w-0 is load-bearing. This panel is usually a grid item, and grid (like
  // flex) items default to min-width:auto — so the tablist's overflow-x-auto
  // can't take effect and the panel widens to fit its widest tab row instead,
  // pushing the whole page into horizontal scroll on narrow screens.
  return (
    <section className={`min-w-0 rounded-2xl border border-border bg-surface shadow-sm shadow-ink-950/[0.03] ${className}`}>
      <div className="flex items-center justify-between gap-3 border-b border-border px-2 pt-2">
        <div role="tablist" aria-label={title} onKeyDown={onKeyDown} className="flex min-w-0 gap-0.5 overflow-x-auto">
          {visible.map((tab, i) => {
            const selected = i === active;
            return (
              <button
                key={tab.key}
                ref={(el) => {
                  refs.current[i] = el;
                }}
                role="tab"
                type="button"
                id={`tab-${tab.key}`}
                aria-selected={selected}
                aria-controls={`panel-${tab.key}`}
                tabIndex={selected ? 0 : -1}
                onClick={() => setActive(i)}
                className={`shrink-0 rounded-t-lg border-b-2 px-3 py-2 text-xs font-semibold tracking-wide whitespace-nowrap uppercase transition ${
                  selected
                    ? 'border-brand-500 text-brand-600'
                    : 'border-transparent text-text-subtle hover:text-text'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
        {action ? <div className="shrink-0 pr-2 pb-1">{action}</div> : null}
      </div>

      <div role="tabpanel" id={`panel-${current.key}`} aria-labelledby={`tab-${current.key}`} className="py-1">
        {current.content}
      </div>
    </section>
  );
}
