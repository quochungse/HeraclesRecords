import { useMemo, useState, type CSSProperties } from "react";
import { Activity, ArrowUpRight, Check, ChevronRight, type LucideIcon } from "lucide-react";
import type {
  StrengthLoadSource,
  TrainingHubActivity,
  TrainingHubSportType,
  TrainingHubUpcomingWorkout
} from "../../../electron/types";
import { activityLoad, activityLoadNote, comparableLoads, inLoadSource, plannedLoad } from "../loadFigures";
import { useLoadSource } from "../loadSource";
import type { HeraclesRecordsApi } from "../../heraclesrecords-api";
import { workoutSportView } from "../../calendar/workoutSportIcons";
import { useUnitSystem } from "../../units/UnitSystemProvider";
import { useTodayKey } from "../useTodayKey";
import {
  filterUpcomingWorkoutsFromToday,
  formatDistanceMeters,
  formatDurationSpan,
  formatUpcomingWorkoutRowStats,
  formatUpcomingWorkoutStats,
  getLocalHappenDayKey
} from "../formatters";
import { happenDayToDate } from "../parsers";
import { SPORT_COLOR_LABELS, sportColorCategory, type SportColorCategory } from "../sportColors";
import { planTag, scheduledWorkoutSport } from "../workoutSport";
import { UpcomingWorkoutDetailPanel } from "../components/UpcomingWorkoutDetailPanel";
import { getIntlLocale, t } from "../../i18n/core";
import { useI18n } from "../../i18n/useI18n";
import { loadAgainstPlan, nextDays, todayItems, weekAhead, type TodayItem } from "./comingUpModel";

function plannedView(workout: TrainingHubUpcomingWorkout): { category: SportColorCategory; icon: LucideIcon } {
  const sport = scheduledWorkoutSport(workout.sportType);
  return sport ? workoutSportView(sport) : { category: "other", icon: Activity };
}

function doneLine(
  activity: TrainingHubActivity,
  unitSystem: Parameters<typeof formatDistanceMeters>[1],
  loadSource: StrengthLoadSource
): string {
  const load = activityLoad(activity, loadSource);
  return [
    activity.distance && activity.distance > 0 ? formatDistanceMeters(activity.distance, unitSystem) : null,
    activity.duration && activity.duration > 0 ? formatDurationSpan(activity.duration) : null,
    load && load > 0 ? t("units.trainingLoadShort", { value: Math.round(load) }) : null
  ]
    .filter(Boolean)
    .join(" · ");
}

function activityTitle(activity: TrainingHubActivity): string {
  return activity.name?.trim() || SPORT_COLOR_LABELS[sportColorCategory(activity.sportType)];
}

/** "Tue" over "Oct 27"; tomorrow is said as such, over its weekday and date. */
function dayLabels(happenDay: string, now: Date): { day: string; date: string } {
  const date = happenDayToDate(happenDay);
  if (!date) {
    return { day: happenDay, date: "" };
  }
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const locale = getIntlLocale();
  if (happenDay === getLocalHappenDayKey(tomorrow)) {
    return {
      day: t("overview.comingUp.tomorrow"),
      date: new Intl.DateTimeFormat(locale, { weekday: "short", month: "short", day: "numeric" }).format(date)
    };
  }
  return {
    day: new Intl.DateTimeFormat(locale, { weekday: "short" }).format(date),
    date: new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(date)
  };
}

function SportTile({ category, icon: Icon, done }: { category: SportColorCategory; icon: LucideIcon; done?: boolean }) {
  const Glyph = done ? Check : Icon;
  return (
    <span className="overview-plan-icon" data-sport={category} aria-hidden="true">
      <Glyph size={20} strokeWidth={2} />
    </span>
  );
}

/**
 * One of today's sessions, what it is and what it came to, pressed as a whole
 * as a day on the right is: a plan opens the Calendar's sheet, a session its
 * own page. A session with no way to open it is not a button.
 */
function TodayEntry({
  item,
  lead,
  onOpenWorkout,
  onOpenActivity
}: {
  item: TodayItem;
  /** The only thing today holds, drawn at full size with its plan beside it. */
  lead: boolean;
  onOpenWorkout: (workout: TrainingHubUpcomingWorkout) => void;
  onOpenActivity?: (activityId: string) => void;
}) {
  const { unitSystem } = useUnitSystem();
  const { source: loadSource } = useLoadSource();
  const className = `overview-plan-entry${item.kind === "done" ? " is-done" : ""}${lead ? " is-lead" : ""}`;
  const chevron = <ChevronRight className="overview-plan-chevron" size={18} aria-hidden="true" />;
  if (item.kind === "planned") {
    const view = plannedView(item.workout);
    const tag = planTag(item.workout);
    const stats = formatUpcomingWorkoutRowStats(item.workout.volume, plannedLoad(item.workout, loadSource), unitSystem);
    return (
      <button type="button" className={className} onClick={() => onOpenWorkout(item.workout)}>
        <SportTile category={view.category} icon={view.icon} />
        <span className="overview-plan-copy">
          <span className="overview-plan-title">
            <span>{item.workout.name}</span>
            {tag ? <span className="overview-chip">{tag}</span> : null}
          </span>
          {stats ? <span className="overview-plan-meta">{stats}</span> : null}
        </span>
        {chevron}
      </button>
    );
  }

  const { activity, workout } = item;
  const category = sportColorCategory(activity.sportType);
  const compared = lead && workout ? comparableLoads(workout, activity, loadSource) : undefined;
  const against = compared ? loadAgainstPlan(compared.done, compared.planned) : undefined;
  const name = activityTitle(activity);
  // Named by its plan, the session's own name goes with its figures.
  const meta = [workout && workout.name !== name ? name : null, doneLine(activity, unitSystem, loadSource)]
    .filter(Boolean)
    .join(" · ");
  const loadTitle = activityLoadNote(activity, loadSource);
  const body = (
    <>
      <SportTile category={category} icon={Check} done />
      <span className="overview-plan-copy">
        <span className="overview-plan-title">
          <span>{workout?.name ?? name}</span>
          <span className="overview-chip is-done">{t("overview.comingUp.done")}</span>
        </span>
        <span className="overview-plan-meta" title={loadTitle}>{meta}</span>
      </span>
      {onOpenActivity ? chevron : null}
      {against ? (
        <span className="overview-plan-against">
          <span
            className="overview-plan-against-bar"
            style={{ "--against-fill": against.fill, "--against-mark": against.mark } as CSSProperties}
            aria-hidden="true"
          >
            <span />
            <b />
          </span>
          <span className="overview-plan-meta">{t("overview.comingUp.ofPlannedLoad", { percent: against.percent })}</span>
        </span>
      ) : null}
    </>
  );
  return onOpenActivity ? (
    <button type="button" className={className} onClick={() => onOpenActivity(activity.activityId)}>
      {body}
    </button>
  ) : (
    <div className={className}>{body}</div>
  );
}

/**
 * Coming up: today on the left — what is done, read against its plan, and
 * what is still to do — and the days after it on the right. A workout opens in
 * the Calendar's detail sheet, a session on its own sport's page.
 */
export function OverviewComingUp({
  api,
  upcomingWorkouts,
  activities,
  sportTypes,
  onOpenActivity,
  onOpenCalendar
}: {
  api: HeraclesRecordsApi;
  upcomingWorkouts: TrainingHubUpcomingWorkout[];
  activities: TrainingHubActivity[];
  sportTypes: TrainingHubSportType[];
  onOpenActivity?: (activityId: string) => void;
  onOpenCalendar?: () => void;
}) {
  useI18n();
  const { unitSystem } = useUnitSystem();
  const { source: loadSource } = useLoadSource();
  const [selected, setSelected] = useState<TrainingHubUpcomingWorkout | null>(null);
  // Read again when the day turns over: left open past midnight, today's
  // sessions must not stay under Today and turn up under the next days too.
  const todayKey = useTodayKey();
  const now = useMemo(() => new Date(), [todayKey]);
  const scheduled = useMemo(
    () => filterUpcomingWorkoutsFromToday(upcomingWorkouts, now),
    [upcomingWorkouts, now]
  );
  const today = useMemo(
    () => todayItems(scheduled, activities, now, loadSource),
    [scheduled, activities, now, loadSource]
  );
  const later = useMemo(() => nextDays(scheduled, now), [scheduled, now]);
  const ahead = useMemo(
    () => inLoadSource(weekAhead(scheduled, activities, now, loadSource), loadSource),
    [scheduled, activities, now, loadSource]
  );

  // Nothing on the calendar and nothing done today: no section at all, rather
  // than a row spent saying so.
  if (scheduled.length === 0 && today.length === 0) {
    return null;
  }

  const done = today.filter((item) => item.kind === "done").length;
  const state = today.length === 0 ? "rest" : done === today.length ? "done" : "planned";
  const dateLabel = new Intl.DateTimeFormat(getIntlLocale(), {
    weekday: "short",
    month: "short",
    day: "numeric"
  }).format(now);

  return (
    <section className="overview-section" aria-labelledby="overview-plan-title">
      <div className="overview-section-head">
        <h2 id="overview-plan-title" className="overview-section-title">
          {t("overview.comingUp.title")}
        </h2>
        {ahead.length > 0 ? (
          <span className="overview-section-aside">
            {t("overview.comingUp.summary", { stats: formatUpcomingWorkoutStats(ahead, unitSystem) })}
          </span>
        ) : null}
        {onOpenCalendar ? (
          <button type="button" className="overview-section-link" onClick={onOpenCalendar}>
            {t("nav.calendar")}
            <ArrowUpRight size={14} aria-hidden="true" />
          </button>
        ) : null}
      </div>

      <div className="panel overview-plan">
        <div className={`overview-plan-today is-${state}`}>
          <p className="eyebrow">
            {t("overview.today")} · {dateLabel}
            {today.length > 1
              ? ` · ${t("overview.comingUp.doneOf", { done, total: today.length })}`
              : null}
          </p>
          {today.length === 0 ? (
            <div className="overview-plan-rest">
              <p className="overview-plan-title">{t("overview.upcoming.restDay")}</p>
              <p className="overview-plan-meta">{t("overview.upcoming.noneToday")}</p>
            </div>
          ) : (
            <ul className="overview-plan-list">
              {today.map((item) => (
                <li key={item.key}>
                  <TodayEntry
                    item={item}
                    lead={today.length === 1}
                    onOpenWorkout={setSelected}
                    onOpenActivity={onOpenActivity}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="overview-plan-next">
          <p className="eyebrow">{t("overview.comingUp.nextDays")}</p>
          {later.length > 0 ? (
            <ol className="overview-plan-list">
              {later.map((workout, index) => {
                const labels = dayLabels(workout.happenDay, now);
                const tag = planTag(workout);
                const stats = formatUpcomingWorkoutRowStats(workout.volume, plannedLoad(workout, loadSource), unitSystem);
                return (
                  <li key={`${workout.happenDay}:${index}`}>
                    <button
                      type="button"
                      className="overview-plan-row"
                      onClick={() => setSelected(workout)}
                    >
                      <span className="overview-plan-dot" aria-hidden="true" />
                      <span className="overview-plan-when">
                        <strong>{labels.day}</strong>
                        <span>{labels.date}</span>
                      </span>
                      <span className="overview-plan-what">
                        <span className="overview-plan-title">
                          <span>{workout.name}</span>
                          {tag ? <span className="overview-chip">{tag}</span> : null}
                        </span>
                        {stats ? <span className="overview-plan-meta">{stats}</span> : null}
                      </span>
                      <ChevronRight className="overview-plan-chevron" size={18} aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="overview-plan-meta overview-plan-empty">{t("overview.comingUp.nothingNext")}</p>
          )}
        </div>
      </div>

      <UpcomingWorkoutDetailPanel
        api={api}
        workout={selected}
        sportTypes={sportTypes}
        onClose={() => setSelected(null)}
      />
    </section>
  );
}
