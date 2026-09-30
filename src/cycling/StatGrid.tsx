/** One figure on the ride page: what it is, its value, and what it means on hover. */
export interface Stat {
  label: string;
  value: string;
  title?: string;
}

/** The ride page's grid of figures, in Running's `.run-detail-stats` cards. */
export function StatGrid({ stats }: { stats: readonly Stat[] }) {
  return (
    <div className="run-detail-stats">
      {stats.map((stat) => (
        <div className="running-stat" key={stat.label} title={stat.title}>
          <span>{stat.label}</span>
          <strong>{stat.value}</strong>
        </div>
      ))}
    </div>
  );
}
