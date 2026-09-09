import { useCallback, useEffect, useMemo, useState } from "react";
import { LockKeyhole, RefreshCw } from "lucide-react";
import { SleepNightDetail } from "./components/SleepNightDetail";
import { SleepNightList } from "./components/SleepNightList";
import { SleepTrendChart } from "./components/SleepTrendChart";
import { useSleepHistory } from "./useSleepHistory";
import { useSleepNightSeries } from "./useSleepNightSeries";
import { HrvBaselineChart } from "../training/components/HrvBaselineChart";
import type { CorosLinkApi } from "../coroslink-api";
import type { TrainingTrendPoint } from "../training/types";
import "./sleep.css";

interface SleepDetailsViewProps {
  api: CorosLinkApi | null;
  connected: boolean;
  /**
   * Nightly HRV and its baseline, from the training snapshot App.tsx already
   * holds. They arrive as a prop rather than through `useSleepHistory` because
   * COROS sends no HRV with a sleep record at all — it lives in daily metrics.
   */
  trendPoints: TrainingTrendPoint[];
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
  trendPoints,
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
  const {
    series,
    loading: seriesLoading,
    refresh: refreshSeries
  } = useSleepNightSeries(api, selectedDay);

  // One button, the whole screen: refreshing the nights but leaving the curve
  // on a cached copy would have the two halves of the panel describing
  // different fetches.
  const refreshAll = useCallback(() => {
    refresh();
    refreshSeries();
  }, [refresh, refreshSeries]);
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

  const countLabel =
    records.length === 0
      ? loading
        ? "Loading nights…"
        : "No nights on file"
      : `${records.length} ${records.length === 1 ? "night" : "nights"} on file`;

  return (
    // Deliberately not `stack-fill`: this screen is a document that grows past
    // the window — a list, a night, a month of trend — and the fill variant
    // pins it to the viewport, which is what was clipping the detail pane.
    <div className="stack sleep-details-view">
      <header className="sleep-page-header">
        <div className="sleep-page-heading">
          <p className="eyebrow">COROS</p>
          <h1>Sleep</h1>
          <p className="sleep-page-subtitle">
            {countLabel}
            {fetchedAtLabel ? (
              <>
                <span aria-hidden="true"> · </span>
                {snapshot?.source === "cache" ? "cached " : "updated "}
                {fetchedAtLabel}
              </>
            ) : null}
          </p>
        </div>

        <button
          type="button"
          className="icon-button sleep-refresh-button"
          onClick={refreshAll}
          disabled={refreshing || loading}
          aria-label={refreshing ? "Refreshing sleep data" : "Refresh sleep data"}
          title="Refresh"
        >
          <RefreshCw
            size={16}
            className={refreshing ? "spin" : undefined}
            aria-hidden="true"
          />
        </button>
      </header>

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

      <section className="panel sleep-details-panel">
        <div className="sleep-details-split">
          <div className="sleep-details-list">
            <h2 className="sleep-pane-title">Recent sleeps</h2>
            <div className="sleep-night-list-scroll">
              <SleepNightList
                records={records}
                selectedDay={selectedDay}
                onSelect={setSelectedDay}
                loading={loading}
              />
            </div>
          </div>

          <div className="sleep-details-main">
            <SleepNightDetail
              record={selected}
              series={series}
              seriesLoading={seriesLoading}
              pending={loading && records.length === 0}
              hasNights={records.length > 0}
            />
          </div>
        </div>
      </section>

      <section className="panel sleep-trend-panel">
        <h2 className="sleep-pane-title">Sleep length and score</h2>
        <SleepTrendChart
          records={records}
          selectedDay={selectedDay ?? undefined}
          onSelectDay={setSelectedDay}
        />
      </section>

      <HrvBaselineChart points={trendPoints} />
    </div>
  );
}
