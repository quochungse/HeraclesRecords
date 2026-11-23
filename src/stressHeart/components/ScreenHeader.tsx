import { RefreshCw } from "lucide-react";
import type { StressHeartSnapshot } from "../../../electron/types";
import { dayDate } from "../stressHeartModel";
import { useI18n } from "../../i18n/useI18n";

interface ScreenHeaderProps {
  title: string;
  snapshot: StressHeartSnapshot | null;
  loading: boolean;
  refreshing: boolean;
  refreshLabel: string;
  refreshingLabel: string;
  onRefresh: () => void;
}

/** The page's title, how much is on file and from when, and Refresh. */
export function ScreenHeader({
  title,
  snapshot,
  loading,
  refreshing,
  refreshLabel,
  refreshingLabel,
  onRefresh
}: ScreenHeaderProps) {
  const { t, plural, intl } = useI18n();
  const records = snapshot?.days ?? [];
  const fetchedAt = snapshot?.fetchedAt;
  const fetchedLabel =
    fetchedAt !== undefined
      ? new Intl.DateTimeFormat(intl, { hour: "numeric", minute: "2-digit", month: "short", day: "numeric" }).format(
          new Date(fetchedAt)
        )
      : null;
  const countLabel =
    records.length === 0
      ? loading
        ? t("stress.loadingDays")
        : t("stress.noDays")
      : plural("stress.daysOnFile", records.length, {
          since: new Intl.DateTimeFormat(intl, { month: "short", day: "numeric", year: "numeric" }).format(
            dayDate(records[0].day)
          )
        });

  return (
    <header className="stress-page-header">
      <div className="stress-page-heading">
        <p className="eyebrow">COROS</p>
        <h1>{title}</h1>
        <p className="stress-page-subtitle">
          {countLabel}
          {fetchedLabel ? (
            <>
              <span aria-hidden="true"> · </span>
              {snapshot?.source === "cache"
                ? t("stress.cachedAt", { time: fetchedLabel })
                : t("stress.updatedAt", { time: fetchedLabel })}
            </>
          ) : null}
        </p>
      </div>
      <button
        type="button"
        className="icon-button stress-refresh-button"
        onClick={onRefresh}
        disabled={refreshing || loading}
        aria-label={refreshing ? refreshingLabel : refreshLabel}
        title={t("common.refresh")}
      >
        <RefreshCw size={16} className={refreshing ? "spin" : undefined} aria-hidden="true" />
      </button>
    </header>
  );
}
