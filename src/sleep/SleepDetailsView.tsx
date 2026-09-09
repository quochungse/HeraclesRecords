import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, LockKeyhole, MoonStar, RefreshCw } from "lucide-react";
import { SleepNightDetail } from "./components/SleepNightDetail";
import { SleepNightList } from "./components/SleepNightList";
import { SleepTrendChart } from "./components/SleepTrendChart";
import { useSleepHistory } from "./useSleepHistory";
import { useSleepNightSeries } from "./useSleepNightSeries";
import type { CorosLinkApi } from "../coroslink-api";
import "./sleep.css";

interface SleepDetailsViewProps {
  api: CorosLinkApi | null;
  connected: boolean;
  onOpenOverview: () => void;
}

function formatFetchedAt(fetchedAt?: number): string | null {
  if (fetchedAt === undefined || !Number.isFinite(fetchedAt)) {
    return null;
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    day: "numeric"
  }).format(new Date(fetchedAt));
}

export function SleepDetailsView({
  api,
  connected,
  onOpenOverview
}: SleepDetailsViewProps) {
  const { snapshot, loading, refreshing, error, refresh } = useSleepHistory(
    api,
    connected
  );
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const records = useMemo(() => snapshot?.records ?? [], [snapshot]);

  // Follow the newest night until the athlete picks one, and let go of a
  // selection whose night has fallen out of the window.
  useEffect(() => {
    if (records.length === 0) {
      setSelectedDay(null);
      return;
    }

    setSelectedDay((current) =>
      current && records.some((record) => record.happenDay === current)
        ? current
        : records[0].happenDay
    );
  }, [records]);

  const selected =
    records.find((record) => record.happenDay === selectedDay) ?? null;
  const { series, loading: seriesLoading } = useSleepNightSeries(api, selectedDay);
  const fetchedAtLabel = formatFetchedAt(snapshot?.fetchedAt);

  if (!connected) {
    return (
      <section className="panel data-connect-panel">
        <LockKeyhole size={24} aria-hidden="true" />
        <div>
          <h3>Connect COROS first</h3>
          <p>
            Sleep comes from your COROS account. Signing in lives on Overview;
            connect there and your nights load here.
          </p>
        </div>
        <button type="button" className="primary-button" onClick={onOpenOverview}>
          Open Overview
        </button>
      </section>
    );
  }

  return (
    <div className="stack stack-fill training-dashboard sleep-details-view">
      <section className="panel panel-flex sleep-details-panel">
        <div className="sleep-details-toolbar">
          <div className="sleep-details-title">
            <button
              type="button"
              className="ghost-button sleep-back-button"
              onClick={onOpenOverview}
            >
              <ArrowLeft size={15} aria-hidden="true" />
              Overview
            </button>
            <div>
              <p className="eyebrow">Sleep</p>
              <h2>
                {records.length} {records.length === 1 ? "night" : "nights"} on file
              </h2>
            </div>
          </div>

          <div className="sleep-details-actions">
            {fetchedAtLabel ? (
              <span className="sleep-details-updated">
                {snapshot?.source === "cache" ? "From cache · " : ""}
                Updated {fetchedAtLabel}
              </span>
            ) : null}
            <button
              type="button"
              className="ghost-button"
              onClick={refresh}
              disabled={refreshing || loading}
            >
              <RefreshCw
                size={15}
                className={refreshing ? "spin" : undefined}
                aria-hidden="true"
              />
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </div>

        {error ? (
          <p className="sleep-details-error">
            COROS did not answer: {error}. Showing what is already on this machine.
          </p>
        ) : null}

        {snapshot && !snapshot.mcpConnected ? (
          <p className="sleep-details-error">
            COROS data access is not connected, so no new nights can arrive.
            Connect it from Coach settings.
          </p>
        ) : null}

        <div className="sleep-details-split">
          <div className="sleep-details-list">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Recent sleeps</p>
                <h3>Last {records.length > 0 ? records.length : ""} nights</h3>
              </div>
              <MoonStar size={20} aria-hidden="true" />
            </div>
            <SleepNightList
              records={records}
              selectedDay={selectedDay}
              onSelect={setSelectedDay}
              loading={loading}
            />
          </div>

          <div className="sleep-details-main">
            <SleepNightDetail
              record={selected}
              series={series}
              seriesLoading={seriesLoading}
            />
          </div>
        </div>
      </section>

      <section className="panel sleep-trend-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Trend</p>
            <h3>Sleep length and score</h3>
          </div>
        </div>
        <SleepTrendChart
          records={records}
          selectedDay={selectedDay ?? undefined}
          onSelectDay={setSelectedDay}
        />
      </section>
    </div>
  );
}
