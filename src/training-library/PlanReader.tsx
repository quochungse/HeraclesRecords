/**
 * A plan, to read.
 *
 * Opening a plan used to mean opening the editor: a full builder with an
 * undo stack, drag targets and an add-week button, reached by everyone who
 * only wanted to see what was in week 6. For a COROS plan it also cost a
 * round trip before anything appeared, because the editor wanted the deep
 * copy. This screen opens from the snapshot already in hand and asks for
 * nothing, and editing is a button on it rather than the way in.
 *
 * What it shows that the library row cannot: the weeks themselves, the
 * sessions inside them, and — once the plan is on the calendar — which of
 * those sessions were kept. The row says 72%; this says which ones.
 *
 * **A running plan opens on this week.** The question asked of it nine times
 * in ten is "what is today", and the answer was below every week already
 * trained. So the weeks before this one fold to a line each — sessions, kept,
 * missed — and the reader is scrolled to the week being trained, with today's
 * column marked. A plan that is not running opens at its top, unfolded: every
 * week of it is equally the thing being read.
 */
import {
  Archive,
  ArchiveRestore,
  CalendarCheck,
  CalendarPlus,
  CalendarX,
  Check,
  ChevronRight,
  Copy,
  Eraser,
  FilePen,
  Heart,
  LoaderCircle,
  MessageCircle,
  Pencil,
  Trash2,
  X
} from "lucide-react";
import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent
} from "react";
import type {
  TrainingActivityMatch,
  TrainingPlanDocument,
  TrainingPlanEntry
} from "../../electron/types";
import { summarizeTrainingPlan } from "../../electron/trainingPlanDomain";
import type { CorosLinkApi } from "../coroslink-api";
import { useUnitSystem } from "../units/UnitSystemProvider";
import { formatDistanceValue } from "../units/units";
import { describeCompliance, formatCompliance, planCompliance } from "./planCompliance";
import { planStartLabel, planWeekPosition } from "./planFilters";
import { PlanEntryRow } from "./PlanEntryRow";
import { formatWeekLine, planSessions, readPlan, type PlanReaderWeek } from "./planReaderModel";
import { PlanSessionView } from "./PlanSessionView";
import { PlanWeekRidge } from "./PlanWeekRidge";
import { PlanOriginBadge, SportMixDots, dominantSport, sportAccentStyle } from "./sportTheme";
import { PlanCalendarBadge, isOnCalendar, upcomingCalendarSessions } from "./PlanCalendarBadge";
import { PlanMenu, type PlanMenuItem } from "./PlanMenu";
import { PlanDraftMark } from "./PlanDraftMark";

/** What the reader's calendar item asks for. */
export type PlanCalendarAction = "add" | "remove";

interface PlanReaderProps {
  plan: TrainingPlanDocument;
  matches: readonly TrainingActivityMatch[];
  offline?: boolean;
  /** Only so a session can name its exercises and read the account's pool
      length; without it a session still opens and draws its steps. */
  api?: CorosLinkApi;
  /**
   * The plan is being read in full behind this one. Edit waits: a save writes
   * every session's program back, and the shallow copy has none.
   */
  loadingFull?: boolean;
  /**
   * This plan is being copied. Said on screen, and Duplicate waits: the copy
   * opens in the reader when COROS has written it, and a second press would
   * write a second one.
   */
  duplicating?: boolean;
  /** The clock, for a suite that cannot move the real one. */
  today?: Date;
  onBack: () => void;
  onEdit: (plan: TrainingPlanDocument) => void;
  onDuplicate?: (plan: TrainingPlanDocument) => void;
  onCalendar?: (plan: TrainingPlanDocument, action: PlanCalendarAction) => void;
  /**
   * Edits to this plan are kept here as a draft. Given, the title says
   * "Editing", Edit becomes Continue editing — one way into the editor, and
   * it picks the kept edit up — and the ⋯ leads with Clear editing. Neither
   * needs COROS: the draft is here.
   */
  onContinueDraft?: () => void;
  onClearDraft?: () => void;
  /*
   * The four that used to live in a tile's corner, appearing on hover. They
   * belong to the plan on screen: an unlabelled glyph revealed by a pointer
   * passing over a card is a poor place for an irreversible delete, and the
   * workout tab already reached that conclusion — "tagging and deleting are
   * the reader's".
   */
  onFavorite?: (plan: TrainingPlanDocument) => void;
  onArchive?: (plan: TrainingPlanDocument) => void;
  onDelete?: (plan: TrainingPlanDocument) => void;
  /** Opens the conversation the plan came from, to ask about it (P1.7). */
  onAskCoach?: (plan: TrainingPlanDocument) => void;
  /** Opens Coach with one session of a COROS plan — any plan, not only Coach's — beside the composer (P3.5). */
  onAskCoachAboutSession?: (plan: TrainingPlanDocument, entry: TrainingPlanEntry, label: string) => void;
  /** A kept session's activity, opened on the screen for its sport. */
  onOpenActivity?: (activityId: string) => void;
}

function localDayKey(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function PlanReader({
  plan,
  matches,
  offline = false,
  api,
  loadingFull = false,
  duplicating = false,
  today,
  onBack,
  onEdit,
  onDuplicate,
  onCalendar: onCalendarAction,
  onContinueDraft,
  onClearDraft,
  onFavorite,
  onArchive,
  onDelete,
  onAskCoach,
  onAskCoachAboutSession,
  onOpenActivity
}: PlanReaderProps) {
  const { unitSystem } = useUnitSystem();
  const summary = useMemo(() => summarizeTrainingPlan(plan), [plan]);
  const reading = useMemo(() => readPlan(plan, matches), [plan, matches]);
  const compliance = useMemo(() => planCompliance(plan, matches), [plan, matches]);

  const onCalendar = isOnCalendar(plan);
  /* A run that is over is history: it can be copied into a new plan, not
     edited or put back on the calendar. That holds for one taken off the
     calendar early as much as for one that ran out — COROS refuses to put a
     stopped run back — but the two are said differently. */
  const finished = plan.calendar === "finished" || plan.calendar === "stopped";
  /* COROS serves plans with nothing in them (the dated instance it makes when
     a plan is applied can come back empty), and there is nothing to schedule. */
  const hasSessions = plan.entries.length > 0;
  const dominant = dominantSport(summary.sportDistribution, plan.sportMix);
  const complianceLabel = formatCompliance(compliance);
  const startLabel = planStartLabel(plan);
  const sessions = useMemo(() => planSessions(reading), [reading]);

  const now = today ?? new Date();
  const todayKey = localDayKey(now);
  const position = planWeekPosition(plan, now);
  const currentWeek = position ? position.week - 1 : undefined;

  /*
   * Weeks folded to a line. Only the weeks before this one, and only while
   * the plan is running — which is the one case where they are behind the
   * reader rather than part of what is being read.
   */
  const [unfolded, setUnfolded] = useState<ReadonlySet<number>>(() => new Set());
  const isFolded = (weekIndex: number) =>
    currentWeek !== undefined && weekIndex < currentWeek && !unfolded.has(weekIndex);
  const unfold = (weekIndex: number) =>
    setUnfolded((held) => (held.has(weekIndex) ? held : new Set(held).add(weekIndex)));
  const toggleFold = (weekIndex: number) =>
    setUnfolded((held) => {
      const next = new Set(held);
      if (next.has(weekIndex)) next.delete(weekIndex);
      else next.add(weekIndex);
      return next;
    });

  /*
   * The session open over the weeks, by entry id rather than by index, so a
   * plan that re-arrives deeper from COROS keeps the same session open.
   */
  const [openId, setOpenId] = useState<string | null>(null);
  const openIndex = openId ? sessions.findIndex((session) => session.entry.id === openId) : -1;
  const open = openIndex >= 0 ? sessions[openIndex] : undefined;

  /*
   * The reader scrolls itself, and a session replaces its content, so coming
   * back has to put the weeks where they were and the focus on the row that
   * was pressed — otherwise every session read from week 9 costs a scroll back
   * down to week 9.
   */
  const scroller = useRef<HTMLElement>(null);
  /*
   * Which edges have content past them, so the reader can fade there instead
   * of cutting a week in half at a hard line. Measured, not assumed: at rest
   * both are off and nothing is fogged, and folding a week or opening a
   * session changes the answer without a scroll — hence the pass after every
   * render as well as on scroll.
   */
  const [edges, setEdges] = useState({ top: false, bottom: false });
  const measureEdges = () => {
    const node = scroller.current;
    if (!node) return;
    const top = node.scrollTop > 2;
    const bottom = node.scrollTop + node.clientHeight < node.scrollHeight - 2;
    setEdges((held) => (held.top === top && held.bottom === bottom ? held : { top, bottom }));
  };
  useLayoutEffect(measureEdges);
  const scrollerClass = `plan-reader${edges.top ? " has-fade-top" : ""}${edges.bottom ? " has-fade-bottom" : ""}`;
  const weeksTop = useRef(0);
  const returnTo = useRef<string | null>(null);
  const openSession = (entryId: string) => {
    weeksTop.current = scroller.current?.scrollTop ?? 0;
    returnTo.current = entryId;
    setOpenId(entryId);
  };
  const closeSession = () => {
    /* A session stepped to from inside another may sit in a folded week, and
       focus cannot land on a row that is not drawn. */
    const back = sessions.find((session) => session.entry.id === returnTo.current);
    if (back) unfold(back.weekIndex);
    setOpenId(null);
  };
  useLayoutEffect(() => {
    const node = scroller.current;
    if (!node) return;
    if (open) {
      node.scrollTop = 0;
      node.querySelector<HTMLElement>(".plan-session-back")?.focus();
      return;
    }
    if (!returnTo.current) return;
    node.scrollTop = weeksTop.current;
    const row = node.querySelector<HTMLElement>(
      `[data-entry-id="${CSS.escape(returnTo.current)}"] button`
    );
    row?.focus({ preventScroll: true });
    /* A session reached by Next may be far from where the weeks were left. */
    if (row) {
      const box = row.getBoundingClientRect();
      const frame = node.getBoundingClientRect();
      if (box.top < frame.top || box.bottom > frame.bottom) {
        row.scrollIntoView({ block: "center" });
      }
    }
    returnTo.current = null;
  }, [open?.entry.id, Boolean(open)]);

  /* Scrolling to a week: the ridge, and the opening of a running plan. */
  /* The opening of a running plan scrolls without taking focus — the sheet
     holds it, for Escape — and week 1 is already where the reader opens. */
  const [jumpTo, setJumpTo] = useState<{ week: number; focus: boolean } | null>(
    currentWeek ? { week: currentWeek, focus: false } : null
  );
  const jump = (weekIndex: number) => {
    unfold(weekIndex);
    setJumpTo({ week: weekIndex, focus: true });
  };
  useLayoutEffect(() => {
    if (jumpTo === null || open) return;
    const node = scroller.current;
    const card = node?.querySelector<HTMLElement>(`[data-week="${jumpTo.week}"]`);
    if (node && card) {
      const offset =
        card.getBoundingClientRect().top - node.getBoundingClientRect().top + node.scrollTop;
      /* A jump the athlete asked for glides; the opening one lands. */
      const glide =
        jumpTo.focus && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      node.scrollTo({ top: Math.max(0, offset - 12), behavior: glide ? "smooth" : "auto" });
      if (jumpTo.focus) card.querySelector<HTMLElement>("h2")?.focus({ preventScroll: true });
    }
    setJumpTo(null);
  }, [jumpTo, open]);

  /*
   * Escape steps back one layer: out of a session to the plan, and only then
   * out of the plan. Caught here, before the sheet's own handler, which would
   * otherwise close the whole reader from inside a session.
   */
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && open) {
      event.stopPropagation();
      closeSession();
    }
  };

  if (open) {
    const openEntry = plan.entries.find((entry) => entry.id === open.entry.id);
    /* Only a session COROS knows by id: Coach reads it with get_training_plan. */
    const askable = onAskCoachAboutSession && plan.remoteId && openEntry?.idInPlan ? openEntry : undefined;
    return (
      <section
        ref={scroller}
        className={scrollerClass}
        style={dominant ? sportAccentStyle(dominant) : undefined}
        aria-label={`${plan.name}: ${open.entry.title}`}
        onKeyDown={onKeyDown}
        onScroll={measureEdges}
      >
        <PlanSessionView
          key={open.entry.id}
          session={open}
          entry={openEntry}
          planName={plan.name}
          position={{ index: openIndex, of: sessions.length }}
          unitSystem={unitSystem}
          api={api}
          onOpenActivity={onOpenActivity}
          onBack={closeSession}
          onAskCoach={
            askable
              ? () =>
                  onAskCoachAboutSession!(
                    plan,
                    askable,
                    [open.entry.title, `Week ${open.weekIndex + 1}`, open.dayLabel, plan.name].filter(Boolean).join(" · ")
                  )
              : undefined
          }
          onStep={(direction) => {
            const next = sessions[openIndex + direction];
            if (next) {
              returnTo.current = next.entry.id;
              setOpenId(next.entry.id);
            }
          }}
        />
      </section>
    );
  }

  /*
   * Only figures the plan states. A zero here is not a measurement: "0 load"
   * is COROS pricing nothing, "0 km" is a strength block, "0 hours" is a plan
   * written in distances — and a row of them under an empty plan read as a
   * plan that had been measured and found to be nothing.
   */
  const hours = reading.timed ? Math.round(summary.durationSeconds / 360) / 10 : 0;
  const figures = [
    { label: "weeks", value: String(plan.weekCount) },
    { label: summary.workouts === 1 ? "session" : "sessions", value: String(summary.workouts) },
    hours ? { label: "hours", value: String(hours) } : null,
    summary.distanceMeters
      ? {
          label: "distance",
          value: formatDistanceValue(summary.distanceMeters, unitSystem, { digits: 0 })
        }
      : null,
    summary.trainingLoad ? { label: "load", value: String(Math.round(summary.trainingLoad)) } : null
  ].filter((figure): figure is { label: string; value: string } => Boolean(figure));

  /* Adding is a button at the head's outer edge; what is done to a plan
     already on the calendar stays behind ⋯. Carrying an edit onto the
     calendar is asked when the edit is saved, not offered here. */
  const calendarItems: PlanMenuItem[] =
    !onCalendarAction || finished || !onCalendar
      ? []
      : [
          {
            label: "Remove from calendar",
            icon: CalendarX,
            disabled: offline,
            title: offline ? "Reconnect to COROS to change the calendar" : undefined,
            onSelect: () => onCalendarAction(plan, "remove")
          }
        ];
  /* With edits kept, Continue editing is the one way into the editor and
     stands outside the menu; otherwise Edit leads it. */
  const editItems: PlanMenuItem[] = onContinueDraft
    ? []
    : [
        {
          label: "Edit",
          icon: Pencil,
          /* The reader moves to the copy when it is made, so an editor
             opened on the original meanwhile would be left behind it. */
          disabled: loadingFull || duplicating || finished || offline,
          title:
            plan.calendar === "stopped"
              ? "This run was taken off the calendar. Duplicate it to use it again."
              : finished
                ? "This run of the plan has finished. Duplicate it to use it again."
                : offline
                  ? "Reconnect to COROS to edit this plan"
                  : loadingFull
                    ? "Reading the full plan from COROS…"
                    : undefined,
          onSelect: () => onEdit(plan)
        }
      ];
  const draftItems: PlanMenuItem[] = onClearDraft
    ? [{ label: "Clear editing", icon: Eraser, danger: true, onSelect: onClearDraft }]
    : [];
  const planItems: PlanMenuItem[] = [
    ...editItems,
    ...(onAskCoach
      ? [{ label: "Ask Coach about this plan", icon: MessageCircle, onSelect: () => onAskCoach(plan) }]
      : []),
    ...calendarItems,
    ...(onDuplicate
      ? [
          {
            label: duplicating ? "Duplicating…" : "Duplicate",
            icon: Copy,
            disabled: offline || duplicating,
            onSelect: () => onDuplicate(plan)
          }
        ]
      : []),
    ...(onArchive
      ? [
          {
            label: plan.archived ? "Restore" : "Archive",
            icon: plan.archived ? ArchiveRestore : Archive,
            onSelect: () => onArchive(plan)
          }
        ]
      : []),
    ...(onDelete
      ? [
          {
            label: "Delete",
            icon: Trash2,
            danger: true,
            /* A plan on the calendar can be deleted too; the confirmation says it
               comes off the calendar first. */
            disabled: offline,
            title: offline ? "Reconnect to COROS to delete this plan" : undefined,
            onSelect: () => onDelete(plan)
          }
        ]
      : [])
  ];
  /* Clearing the draft leads, apart from what acts on the plan on COROS. */
  const menuItems: PlanMenuItem[] = draftItems.length
    ? [...draftItems, ...planItems.map((item, index) => (index === 0 ? { ...item, separated: true } : item))]
    : planItems;

  const showRidge = plan.weekCount > 2 && summary.workouts > 0;

  return (
    <section
      ref={scroller}
      className={scrollerClass}
      style={dominant ? sportAccentStyle(dominant) : undefined}
      aria-label={`${plan.name}, ${plan.weekCount} weeks`}
      onKeyDown={onKeyDown}
      onScroll={measureEdges}
    >
      {/*
       * The reader is a dialog over the library, not a page that replaced it,
       * so its way out is a close rather than a back arrow — "← Plans" said
       * there was a page behind this one, and the library was never gone.
       *
       * The actions read from the right edge inward in the order they are
       * reached for: the calendar, then Continue editing when there are kept
       * edits, the heart, and everything else behind ⋯ — Edit included. The
       * calendar leads because it is what a plan is for; once it is on, the
       * same place says so and does nothing, and taking it off is behind ⋯.
       */}
      <header className="plan-reader-head">
        <button
          type="button"
          className="icon-button plan-reader-close"
          aria-label="Close plan"
          onClick={onBack}
        >
          <X size={16} />
        </button>
        <div className="plan-reader-actions">
          {duplicating ? (
            <span className="plan-reader-busy" role="status">
              <LoaderCircle size={14} className="is-spinning" aria-hidden="true" />
              Duplicating…
            </span>
          ) : null}
          <PlanMenu items={menuItems} />
          {onFavorite ? (
            <button
              type="button"
              className={`icon-button plan-reader-favorite${plan.favorite ? " is-active" : ""}`}
              aria-pressed={plan.favorite}
              aria-label={plan.favorite ? "Remove from favorites" : "Add to favorites"}
              onClick={() => onFavorite(plan)}
            >
              <Heart size={15} fill={plan.favorite ? "currentColor" : "none"} />
            </button>
          ) : null}
          {onContinueDraft ? (
            /* The kept edit is the whole plan already, read in full when it
               was made and held here, so neither COROS nor the full read is
               waited on. Only a copy being made is: the reader moves to it. */
            <button
              type="button"
              className="primary-button plan-reader-edit"
              disabled={duplicating}
              onClick={onContinueDraft}
            >
              <FilePen size={14} /> Continue editing
            </button>
          ) : null}
          {onCalendarAction && !finished ? (
            onCalendar ? (
              /* A statement, not a control: taking it off is behind ⋯. */
              <span
                className="plan-reader-scheduled"
                title={
                  plan.calendar === "running"
                    ? `${upcomingCalendarSessions(plan)} upcoming workout${upcomingCalendarSessions(plan) === 1 ? "" : "s"} on the COROS calendar`
                    : "On the COROS calendar"
                }
              >
                <CalendarCheck size={14} aria-hidden="true" /> On calendar
              </span>
            ) : (
              <button
                type="button"
                className="primary-button plan-reader-add-calendar"
                disabled={offline || !hasSessions}
                title={
                  offline
                    ? "Reconnect to COROS to change the calendar"
                    : !hasSessions
                      ? "This plan has no sessions to put on the calendar"
                      : undefined
                }
                onClick={() => onCalendarAction(plan, "add")}
              >
                <CalendarPlus size={14} /> Add to calendar
              </button>
            )
          ) : null}
        </div>
      </header>

      <div className="plan-reader-title">
        <h1>
          <PlanCalendarBadge plan={plan} />
          {plan.name}
        </h1>
        <p className="plan-reader-meta">
          {onContinueDraft ? <PlanDraftMark kind="editing" /> : null}
          <PlanOriginBadge plan={plan} />
          <SportMixDots sports={plan.sportMix} counts={summary.sportDistribution} />
          {startLabel ? <span>{startLabel}</span> : null}
          {position ? (
            <span className="plan-reader-now">
              Week {position.week} of {position.of}
            </span>
          ) : null}
        </p>
        {plan.description ? <p className="plan-reader-goal">{plan.description}</p> : null}
      </div>

      <div className="plan-reader-figures">
        {figures.map((figure) => (
          <span key={figure.label}>
            <b>{figure.value}</b>
            <small>{figure.label}</small>
          </span>
        ))}
        {/* Only a plan this app put on the calendar has anything to report. */}
        {complianceLabel ? (
          <span className="plan-reader-fig-done">
            <b>{complianceLabel}</b>
            <small>done</small>
          </span>
        ) : null}
      </div>

      {compliance ? (
        <p className="plan-reader-compliance">{describeCompliance(compliance)}</p>
      ) : null}

      {showRidge ? (
        <PlanWeekRidge
          weeks={reading.weeks}
          currentWeek={currentWeek}
          onJump={jump}
        />
      ) : null}

      <ol className="plan-reader-weeks">
        {reading.weeks.map((week) =>
          isFolded(week.weekIndex) ? (
            <FoldedWeek key={week.weekIndex} week={week} onUnfold={() => toggleFold(week.weekIndex)} />
          ) : (
            <WeekCard
              key={week.weekIndex}
              week={week}
              current={week.weekIndex === currentWeek}
              todayKey={todayKey}
              foldable={currentWeek !== undefined && week.weekIndex < currentWeek}
              onFold={() => toggleFold(week.weekIndex)}
              onOpen={openSession}
            />
          )
        )}
      </ol>

    </section>
  );
}

function WeekHeading({ week }: { week: PlanReaderWeek }) {
  return (
    <>
      Week {week.weekIndex + 1}
      {/* A literal space: the flex gap separates these for the eye, but a
          screen reader reads the text nodes and JSX drops the newline between
          them, so the name was "Week 1Base". */}
      {week.stage ? <> <em>{week.stage}</em></> : null}
    </>
  );
}

/** A week already trained, as the one line it comes to. */
function FoldedWeek({ week, onUnfold }: { week: PlanReaderWeek; onUnfold: () => void }) {
  const { done, missed, ahead } = week.outcomes;
  return (
    <li
      className="plan-week-card is-folded"
      data-week={week.weekIndex}
      data-stage={week.stageSlug}
    >
      <button type="button" className="plan-week-fold" aria-expanded={false} onClick={onUnfold}>
        <ChevronRight size={13} strokeWidth={2.4} aria-hidden="true" />
        <h2>
          <WeekHeading week={week} />
        </h2>
        <span className="plan-week-fold-line">{formatWeekLine(week)}</span>
        <span className="plan-week-fold-outcomes">
          {done ? (
            <span data-tone="done">
              <Check size={12} aria-hidden="true" /> {done} done
            </span>
          ) : null}
          {missed ? (
            <span data-tone="missed">
              <X size={12} aria-hidden="true" /> {missed} missed
            </span>
          ) : null}
          {ahead ? <span data-tone="quiet">{ahead} open</span> : null}
        </span>
      </button>
    </li>
  );
}

/**
 * One week of a plan, a column a day. Exported for the generator's last step,
 * which previews the plan it wrote with the reader's own cards rather than a
 * second drawing of a week — there it is read only: no day is today, nothing
 * folds and a session does not open.
 */
export function WeekCard({
  week,
  current = false,
  todayKey = "",
  foldable = false,
  onFold,
  onOpen,
  onAsk
}: {
  week: PlanReaderWeek;
  current?: boolean;
  todayKey?: string;
  foldable?: boolean;
  onFold?: () => void;
  onOpen?: (entryId: string) => void;
  /** Ask Coach about this week — offered where a conversation can take the question. */
  onAsk?: () => void;
}) {
  const { unitSystem } = useUnitSystem();
  const hasAny = week.days.some((day) => day.entries.length);
  return (
    <li
      className={`plan-week-card${current ? " is-current" : ""}`}
      data-week={week.weekIndex}
      data-stage={week.stageSlug}
    >
      <header>
        <h2 tabIndex={-1}>
          <WeekHeading week={week} />
          {current ? <span className="plan-week-now">This week</span> : null}
        </h2>
        <p>{formatWeekLine(week)}</p>
        {foldable ? (
          <button
            type="button"
            className="plan-week-fold-again"
            aria-expanded={true}
            onClick={onFold}
          >
            Fold
          </button>
        ) : null}
        {onAsk ? (
          <button type="button" className="plan-week-fold-again plan-week-ask" onClick={onAsk}>
            Ask Coach
          </button>
        ) : null}
      </header>

      {hasAny ? (
        /*
         * Every day of the week, so a wide reader can lay them out as the
         * calendar does — seven columns, the empty ones included, because a
         * day off is part of a week's shape. A narrow one lists only the days
         * with something in them (`is-empty` is hidden there).
         */
        <div className="plan-reader-days">
          {week.days.map((day) => {
            const isToday = day.date === todayKey;
            return (
              <div
                className={`plan-reader-day${day.entries.length ? "" : " is-empty"}${isToday ? " is-today" : ""}`}
                key={day.dayIndex}
              >
                <span className="plan-reader-day-label">
                  {day.label}
                  {isToday ? <em className="plan-reader-today">Today</em> : null}
                </span>
                <ul className="plan-reader-day-entries">
                  {day.entries.map((entry) => (
                    <PlanEntryRow key={entry.id} entry={entry} unitSystem={unitSystem} onOpen={onOpen} />
                  ))}
                </ul>
              </div>
            );
          })}

        </div>
      ) : (
        /* An empty week is a fact about the plan — a gap in a block, or a
           week not written yet — so it keeps its number and says so, rather
           than being dropped and renumbering everything after it. */
        <p className="plan-reader-empty-week">Nothing planned this week.</p>
      )}
    </li>
  );
}
