/**
 * Placeholders for the two moments this screen is waiting on COROS.
 *
 * Shaped like what they stand in for — four hero cards, a chart, a list — so
 * the page does not jump when the real thing lands. Deliberately plain: they
 * read as "still coming" without a single number, because any number shown
 * before the list arrives is a zero that looks like a fact.
 */

const LIST_ROWS = 6;

export function RunningPageSkeleton() {
  return (
    <div className="running-body" aria-busy="true" aria-label="Loading your runs">
      <div className="run-hero">
        {Array.from({ length: 4 }, (_, index) => (
          <div className="run-hero-card" key={index}>
            <i className="run-skeleton run-skeleton-label" />
            <i className="run-skeleton run-skeleton-value" />
            <i className="run-skeleton run-skeleton-foot" />
          </div>
        ))}
      </div>

      <section className="panel run-block">
        <i className="run-skeleton run-skeleton-label" />
        <i className="run-skeleton run-skeleton-title" />
        <i className="run-skeleton run-skeleton-plot" />
      </section>

      <div className="running-list-panel run-skeleton-list">
        {Array.from({ length: LIST_ROWS }, (_, index) => (
          <div className="run-skeleton-row" key={index}>
            <i className="run-skeleton run-skeleton-chip" />
            <i className="run-skeleton run-skeleton-name" />
            <i className="run-skeleton run-skeleton-cell" />
            <i className="run-skeleton run-skeleton-cell" />
            <i className="run-skeleton run-skeleton-cell" />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Stands in for a block that sorts runs by heart-rate zone while the account's
 * zones are still on their way — see `HeartRateZoneModelState.settled`.
 */
export function RunBlockSkeleton({ label }: { label: string }) {
  return (
    <section className="panel run-block" aria-busy="true" aria-label={label}>
      <i className="run-skeleton run-skeleton-label" />
      <i className="run-skeleton run-skeleton-title" />
      <i className="run-skeleton run-skeleton-plot" />
    </section>
  );
}

/** Stands in for the channel chart and the tables under it. */
export function RunDetailSkeleton() {
  return (
    <div className="run-detail-skeleton" aria-busy="true" aria-label="Loading this run">
      <section className="panel run-block">
        <i className="run-skeleton run-skeleton-label" />
        <div className="run-skeleton-chips">
          {Array.from({ length: 5 }, (_, index) => (
            <i className="run-skeleton run-skeleton-chip-wide" key={index} />
          ))}
        </div>
        <i className="run-skeleton run-skeleton-plot run-skeleton-plot-tall" />
      </section>
      <section className="panel run-block">
        <i className="run-skeleton run-skeleton-label" />
        <i className="run-skeleton run-skeleton-plot" />
      </section>
    </div>
  );
}
