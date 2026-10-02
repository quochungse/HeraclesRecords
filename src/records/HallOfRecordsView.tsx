import { useEffect, useMemo, useState } from "react";
import { ChevronDown, CloudOff, LockKeyhole, RefreshCw } from "lucide-react";
import type { TrainingHubActivity } from "../../electron/types";
import type { HeraclesRecordsApi } from "../heraclesrecords-api";
import { OptionGroup } from "../components/OptionGroup";
import {
  STAGE_NUMERALS,
  type LabourState,
  type LabourStageState
} from "./labours";
import {
  dateOfDay,
  formatDayShort,
  type Milestone,
  type WithinReach
} from "./milestones";
import { LabourMedal, LaurelWreath } from "./recordsIcons";
import {
  FILTER_LABELS,
  filtersInUse,
  foldTimeline,
  groupTimeline,
  matchesFilter,
  visibleInMonth,
  type TimelineFilter,
  type TimelineMonth
} from "./timelineModel";
import {
  usePlaceNames,
  useRecordsBackfill,
  type HallOfRecordsState
} from "./useHallOfRecords";
import "./records.css";

export type RecordsTab = "timeline" | "labours";

export type MilestoneActivity = NonNullable<Milestone["activity"]>;

interface HallOfRecordsViewProps {
  api: HeraclesRecordsApi;
  records: HallOfRecordsState;
  activities: readonly TrainingHubActivity[];
  connected: boolean;
  /** Milestones the athlete has not seen yet, marked "New". */
  newIds: ReadonlySet<string>;
  onOpenActivity: (activity: MilestoneActivity) => void;
  onOpenOverview: () => void;
  /** The activity list is being asked for again. */
  retrying?: boolean;
  onRetryActivities?: () => void;
  /** A tab something sent the athlete to — the celebration's "See the Twelve Labours". */
  requestedTab?: RecordsTab | null;
  onTabRequestHandled?: () => void;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const TOTAL_STAGES = 36;

/**
 * The Hall of Records: every milestone the athlete has reached, newest first,
 * and the Twelve Labours read off them.
 *
 * Everything on it is worked out in App (`useHallOfRecords`) so the rail and
 * the notifications know it on any screen; what costs a request — reading the
 * older activities for their best efforts and start, and naming the places —
 * happens only while this screen is open.
 */
export function HallOfRecordsView({
  api,
  records,
  activities,
  connected,
  newIds,
  onOpenActivity,
  onOpenOverview,
  retrying = false,
  onRetryActivities,
  requestedTab,
  onTabRequestHandled
}: HallOfRecordsViewProps) {
  const [tab, setTab] = useState<RecordsTab>(requestedTab ?? "timeline");
  useEffect(() => {
    if (!requestedTab) return;
    setTab(requestedTab);
    onTabRequestHandled?.();
  }, [requestedTab, onTabRequestHandled]);
  const [filter, setFilter] = useState<TimelineFilter>("all");
  const [openGaps, setOpenGaps] = useState<Set<string>>(() => new Set());
  const [openMonths, setOpenMonths] = useState<Set<string>>(() => new Set());
  const [focus, setFocus] = useState<string | null>(null);
  const { result, labours, ready } = records;

  const backfill = useRecordsBackfill({
    api,
    activities,
    summaries: records.summaries,
    enabled: connected,
    onSummaries: records.mergeSummaries
  });
  usePlaceNames({
    cells: result.places,
    enabled: connected,
    onNamed: records.refreshPlaceLabels
  });

  const filters = useMemo(() => filtersInUse(result.milestones), [result.milestones]);
  const shown = useMemo(
    () => result.milestones.filter((milestone) => matchesFilter(milestone, filter)),
    [result.milestones, filter]
  );
  const timeline = useMemo(
    () => foldTimeline(groupTimeline(shown), openGaps, openMonths),
    [shown, openGaps, openMonths]
  );

  // A stage's date on the Labours tab jumps to the milestone that reached it.
  useEffect(() => {
    if (!focus || tab !== "timeline") return;
    const frame = window.requestAnimationFrame(() => {
      const element = document.getElementById(`milestone-${focus}`);
      element?.scrollIntoView({ block: "center", behavior: "smooth" });
      element?.querySelector<HTMLElement>("button, [tabindex]")?.focus({ preventScroll: true });
      setFocus(null);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focus, tab, timeline]);

  const labourOf = useMemo(
    () => new Map(labours.map((labour) => [labour.definition.id, labour])),
    [labours]
  );

  const reachedStages = labours.reduce((total, labour) => total + labour.reached, 0);
  const completeLabours = labours.filter((labour) => labour.complete).length;
  const first = result.milestones.find((milestone) => milestone.id === "start");

  // The month is opened for good, not for the jump: held open only while
  // `focus` was set, it folded back into its gap a frame after the scroll began.
  const showMilestone = (id: string) => {
    const month = result.milestones.find((milestone) => milestone.id === id)?.day.slice(0, 6);
    if (month) setOpenMonths((current) => new Set(current).add(month));
    setFilter("all");
    setTab("timeline");
    setFocus(id);
  };

  if (!connected) {
    return (
      <section className="records-view">
        <header className="records-page-header">
          <div>
            <h1>Hall of Records</h1>
            <p>Every milestone of your training, and the Twelve Labours.</p>
          </div>
        </header>
        <section className="panel data-connect-panel">
          <LockKeyhole size={24} aria-hidden="true" />
          <div>
            <h3>Connect COROS first</h3>
            <p>Your milestones are worked out from your COROS activity history.</p>
          </div>
          <button type="button" className="primary-button" onClick={onOpenOverview}>
            Open Overview
          </button>
        </section>
      </section>
    );
  }

  return (
    <section className="records-view">
      <header className="records-page-header">
        <div>
          <h1>Hall of Records</h1>
          <p>
            {ready && first
              ? `${result.milestones.length} milestones since ${formatDayShort(first.day)} · ${reachedStages} of ${TOTAL_STAGES} labour stages`
              : ready || records.failed
                ? "Every milestone of your training, and the Twelve Labours."
                : "Reading your history…"}
          </p>
        </div>
        <OptionGroup<RecordsTab>
          label="Hall of Records sections"
          value={tab}
          onChange={setTab}
          options={[
            { value: "timeline", label: "Timeline" },
            { value: "labours", label: "The Twelve Labours" }
          ]}
        />
      </header>

      {backfill.remaining !== undefined && backfill.remaining > 0 ? (
        <p className="records-backfill" role="status">
          {backfill.paused
            ? `${backfill.remaining} older activities still to read for records and places — the rest on your next visit.`
            : `Reading ${backfill.remaining} older activities for records and places…`}
        </p>
      ) : null}

      {records.failed ? (
        <section className="panel data-connect-panel">
          <CloudOff size={24} aria-hidden="true" />
          <div>
            <h3>Your activities did not load</h3>
            <p>
              COROS did not return the activity list the hall is worked out from. This is
              usually the connection; nothing on this machine was lost.
            </p>
          </div>
          {onRetryActivities ? (
            <button
              type="button"
              className="primary-button"
              disabled={retrying}
              onClick={onRetryActivities}
            >
              <RefreshCw size={14} aria-hidden="true" className={retrying ? "spin" : undefined} />
              {retrying ? "Loading" : "Try again"}
            </button>
          ) : null}
        </section>
      ) : !ready ? (
        <RecordsSkeleton />
      ) : result.milestones.length === 0 ? (
        <section className="panel records-empty">
          <h2>The hall is empty, for now</h2>
          <p>Your first activity on COROS opens it.</p>
        </section>
      ) : tab === "timeline" ? (
        <>
          {result.withinReach.length > 0 ? (
            <WithinReachRow items={result.withinReach} labourOf={labourOf} />
          ) : null}

          {filters.length > 2 ? (
            <OptionGroup<TimelineFilter>
              className="records-filters"
              label="Show"
              value={filter}
              onChange={setFilter}
              options={filters.map((value) => ({ value, label: FILTER_LABELS[value] }))}
            />
          ) : null}

          {timeline.map(({ year, blocks }) => (
            <section key={year.year} className="records-year" aria-labelledby={`records-year-${year.year}`}>
              <div className="records-year-head">
                <h2 id={`records-year-${year.year}`}>{year.year}</h2>
                <span>
                  {year.count} {year.count === 1 ? "milestone" : "milestones"}
                </span>
              </div>
              <div className="records-line">
                {blocks.map((block) =>
                  block.kind === "gap" ? (
                    <div key={block.id} className="records-slot records-gap-slot">
                      <span aria-hidden="true" />
                      <span className="records-node is-gap" aria-hidden="true" />
                      <button
                        type="button"
                        className="records-gap"
                        onClick={() => setOpenGaps((current) => new Set(current).add(block.id))}
                      >
                        <strong>{block.label}</strong>
                        <span>
                          {block.count} {block.count === 1 ? "milestone" : "milestones"}
                        </span>
                        {block.note ? <em>{block.note}</em> : null}
                        <ChevronDown size={14} aria-hidden="true" />
                      </button>
                    </div>
                  ) : (
                    <MonthBlock
                      key={block.month.key}
                      month={block.month}
                      expanded={openMonths.has(block.month.key)}
                      onExpand={() =>
                        setOpenMonths((current) => new Set(current).add(block.month.key))
                      }
                      newIds={newIds}
                      labourOf={labourOf}
                      onOpenActivity={onOpenActivity}
                    />
                  )
                )}
              </div>
            </section>
          ))}
        </>
      ) : (
        <LaboursBoard
          labours={labours}
          reachedStages={reachedStages}
          completeLabours={completeLabours}
          onShowMilestone={showMilestone}
        />
      )}
    </section>
  );
}

function RecordsSkeleton() {
  return (
    <div className="records-skeleton" aria-hidden="true">
      <span />
      <span />
      <span />
    </div>
  );
}

// --- Within reach ----------------------------------------------------------------

function WithinReachRow({
  items,
  labourOf
}: {
  items: readonly WithinReach[];
  labourOf: ReadonlyMap<string, LabourState>;
}) {
  return (
    <section className="records-reach" aria-labelledby="records-reach-title">
      <h2 id="records-reach-title" className="records-section-label">
        Within reach
      </h2>
      <div className="records-reach-grid">
        {items.map((item) => (
          <article key={item.id} className="panel records-reach-card">
            <div className="records-reach-head">
              {item.labour ? (
                <LabourMedal
                  id={item.labour.id}
                  reached={labourOf.get(item.labour.id)?.reached ?? 0}
                  size="chip"
                />
              ) : (
                <span className={`records-dot is-${item.sport ?? "other"}`} aria-hidden="true" />
              )}
              <div>
                <p className="records-eyebrow">{item.label}</p>
                <h3>{item.title}</h3>
              </div>
            </div>
            <div
              className="records-progress"
              role="progressbar"
              aria-label={item.title}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(item.ratio * 100)}
            >
              <span style={{ width: `${Math.round(item.ratio * 100)}%` }} />
            </div>
            <div className="records-reach-foot">
              <span className="figure">{item.value}</span>
              <span>{item.hint}</span>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

// --- The timeline -------------------------------------------------------------------

function MonthBlock({
  month,
  expanded,
  onExpand,
  newIds,
  labourOf,
  onOpenActivity
}: {
  month: TimelineMonth;
  expanded: boolean;
  onExpand: () => void;
  newIds: ReadonlySet<string>;
  labourOf: ReadonlyMap<string, LabourState>;
  onOpenActivity: (activity: MilestoneActivity) => void;
}) {
  const entries = visibleInMonth(month, expanded);
  return (
    <>
      <div className="records-slot records-month-slot">
        <span aria-hidden="true" />
        <span className="records-node is-month" aria-hidden="true" />
        <h3 className="records-month">{month.label}</h3>
      </div>
      {entries.map((entry) =>
        entry.kind === "milestone" ? (
          <MilestoneSlot
            key={entry.milestone.id}
            milestone={entry.milestone}
            isNew={newIds.has(entry.milestone.id)}
            labourOf={labourOf}
            onOpenActivity={onOpenActivity}
          />
        ) : (
          <div key="more" className="records-slot records-more-slot">
            <span aria-hidden="true" />
            <span aria-hidden="true" />
            <button type="button" className="records-more" onClick={onExpand}>
              <strong>{entry.hidden.length} more</strong>
              <span>
                {entry.hidden
                  .slice(0, 2)
                  .map((milestone) => milestone.title.replace(/ — .*$/, ""))
                  .join(" · ")}
              </span>
              <ChevronDown size={14} aria-hidden="true" />
            </button>
          </div>
        )
      )}
    </>
  );
}

function MilestoneTitle({
  milestone,
  onOpenActivity,
  className
}: {
  milestone: Milestone;
  onOpenActivity: (activity: MilestoneActivity) => void;
  className: string;
}) {
  const activity = milestone.activity;
  if (!activity) {
    return <span className={className}>{milestone.title}</span>;
  }
  return (
    <button
      type="button"
      className={`${className} records-title-link`}
      onClick={() => onOpenActivity(activity)}
      title="Open this session"
    >
      {milestone.title}
    </button>
  );
}

function LabourBadge({
  milestone,
  labourOf,
  large
}: {
  milestone: Milestone;
  labourOf: ReadonlyMap<string, LabourState>;
  large: boolean;
}) {
  const tag = milestone.labour;
  if (!tag) return null;
  const labour = labourOf.get(tag.id);
  if (!labour) return null;
  // The badge is full gold on the milestone that completed the labour.
  const completing =
    labour.complete &&
    labour.stages.every((stage) => stage.reached && stage.reached.day <= milestone.day);
  const stageText = completing ? "Labour complete" : `Labour ${STAGE_NUMERALS[tag.stage]} of III`;
  return (
    <span
      className={`records-badge ${large ? "is-large" : ""} ${completing ? "is-complete" : ""}`}
      title={`${labour.definition.name} — ${stageText}`}
    >
      <LabourMedal id={tag.id} reached={completing ? 3 : Math.min(tag.stage, 2)} size={large ? "chip" : "badge"} />
      {large ? (
        <span className="records-badge-text">
          <strong>{labour.definition.name}</strong>
          <span>{stageText}</span>
        </span>
      ) : (
        <span className="records-badge-text">
          {labour.definition.short} <strong>{STAGE_NUMERALS[tag.stage]}</strong>
        </span>
      )}
    </span>
  );
}

function MilestoneSlot({
  milestone,
  isNew,
  labourOf,
  onOpenActivity
}: {
  milestone: Milestone;
  isNew: boolean;
  labourOf: ReadonlyMap<string, LabourState>;
  onOpenActivity: (activity: MilestoneActivity) => void;
}) {
  const date = dateOfDay(milestone.day);
  const isStart = milestone.id === "start";
  const kind = isStart ? "start" : milestone.major ? "card" : "row";
  const sport = milestone.sport ?? (milestone.category === "plan" || milestone.labour?.stage === 3 ? "accent" : "none");
  return (
    <div
      id={`milestone-${milestone.id}`}
      className={`records-slot records-milestone is-${kind}`}
    >
      <div className="records-date">
        <span className="figure">{date.getDate()}</span>
        <span>{WEEKDAYS[date.getDay()]}</span>
      </div>
      <span className={`records-node is-${kind} is-${sport}`} aria-hidden="true" />
      {kind === "card" ? (
        <article className={`panel records-card ${milestone.labour?.stage === 3 && labourOf.get(milestone.labour.id)?.complete ? "is-gilded" : ""}`}>
          <div className="records-card-head">
            <div>
              <p className="records-eyebrow">
                {milestone.kind}
                {isNew ? <span className="records-new">New</span> : null}
              </p>
              <MilestoneTitle
                milestone={milestone}
                onOpenActivity={onOpenActivity}
                className="records-card-title"
              />
            </div>
            <LabourBadge milestone={milestone} labourOf={labourOf} large />
          </div>
          {milestone.figures && milestone.figures.length > 0 ? (
            <dl className="records-figures">
              {milestone.figures.map((figure) => (
                <div key={figure.label}>
                  <dt>{figure.label}</dt>
                  <dd>
                    <span className="figure">{figure.value}</span>
                    {figure.unit ? <span className="records-figure-unit">{figure.unit}</span> : null}
                  </dd>
                </div>
              ))}
            </dl>
          ) : milestone.detail ? (
            <p className="records-detail">{milestone.detail}</p>
          ) : null}
          {milestone.context ? <p className="records-context">{milestone.context}</p> : null}
        </article>
      ) : (
        <div className="records-row">
          <div>
            <p className={`records-eyebrow ${isStart ? "is-start" : ""}`}>
              {milestone.kind}
              {isNew ? <span className="records-new">New</span> : null}
            </p>
            <MilestoneTitle
              milestone={milestone}
              onOpenActivity={onOpenActivity}
              className="records-row-title"
            />
            {milestone.detail ? <p className="records-detail">{milestone.detail}</p> : null}
          </div>
          <LabourBadge milestone={milestone} labourOf={labourOf} large={false} />
        </div>
      )}
    </div>
  );
}

// --- The Twelve Labours ----------------------------------------------------------------

function LaboursBoard({
  labours,
  reachedStages,
  completeLabours,
  onShowMilestone
}: {
  labours: readonly LabourState[];
  reachedStages: number;
  completeLabours: number;
  onShowMilestone: (id: string) => void;
}) {
  return (
    <>
      <section className="panel records-apotheosis" aria-labelledby="records-apotheosis-title">
        <span className="records-laurel" aria-hidden="true">
          <LaurelWreath size={40} />
        </span>
        <div className="records-apotheosis-copy">
          <h2 id="records-apotheosis-title" className="records-section-label is-accent">
            Apotheosis
          </h2>
          <p className="records-apotheosis-count">
            <span className="figure">{reachedStages}</span>
            <span>
              of {TOTAL_STAGES} stages · {completeLabours} of 12 labours complete
            </span>
          </p>
          <p className="records-apotheosis-note">
            Complete all twelve and Heracles takes his place on Olympus.
          </p>
        </div>
        <div className="records-pips" aria-label="Stages reached, by labour">
          {labours.map((labour) => (
            <span
              key={labour.definition.id}
              className="records-pip-column"
              title={`${labour.definition.name} — ${labour.reached} of 3`}
            >
              {[1, 2, 3].map((index) => (
                <span key={index} className={index <= labour.reached ? "is-reached" : ""} />
              ))}
            </span>
          ))}
        </div>
      </section>

      <div className="records-labours">
        {labours.map((labour) => (
          <LabourCard key={labour.definition.id} labour={labour} onShowMilestone={onShowMilestone} />
        ))}
      </div>
    </>
  );
}

function LabourCard({
  labour,
  onShowMilestone
}: {
  labour: LabourState;
  onShowMilestone: (id: string) => void;
}) {
  const { definition } = labour;
  return (
    <article
      className={`panel records-labour ${labour.complete ? "is-complete" : ""}`}
      aria-labelledby={`labour-${definition.id}`}
    >
      <div className="records-labour-head">
        <LabourMedal id={definition.id} reached={labour.reached} size="card" />
        <div>
          <p className="records-eyebrow">{definition.category}</p>
          <h3 id={`labour-${definition.id}`}>{definition.name}</h3>
        </div>
        {labour.complete ? (
          <span className="records-complete">Complete</span>
        ) : (
          <span className="records-stage-count figure">
            {labour.reached > 0 ? STAGE_NUMERALS[labour.reached as 1 | 2] : "0"} / III
          </span>
        )}
      </div>
      <p className="records-myth">{definition.myth}</p>
      <ol className="records-stages">
        {labour.stages.map((stage) => (
          <StageRow
            key={stage.stage}
            stage={stage}
            current={!stage.reached && labour.stages.find((candidate) => !candidate.reached) === stage}
            onShowMilestone={onShowMilestone}
          />
        ))}
      </ol>
    </article>
  );
}

function StageRow({
  stage,
  current,
  onShowMilestone
}: {
  stage: LabourStageState;
  current: boolean;
  onShowMilestone: (id: string) => void;
}) {
  const state = stage.reached ? "reached" : current ? "current" : "open";
  const reached = stage.reached;
  return (
    <li className={`records-stage is-${state}`}>
      <span className="records-stage-pip">{STAGE_NUMERALS[stage.stage]}</span>
      <div>
        <div className="records-stage-line">
          <span className="records-stage-title">{stage.title}</span>
          {reached ? (
            <button
              type="button"
              className="records-stage-date"
              onClick={() => onShowMilestone(reached.milestoneId)}
              title="Show it on the timeline"
            >
              {formatDayShort(reached.day)}
            </button>
          ) : null}
        </div>
        {!reached && stage.progress ? (
          <div className="records-stage-progress">
            {current && stage.progress.ratio !== undefined ? (
              <span className="records-progress is-thin" aria-hidden="true">
                <span style={{ width: `${Math.round(stage.progress.ratio * 100)}%` }} />
              </span>
            ) : null}
            <span>{stage.progress.text}</span>
          </div>
        ) : null}
      </div>
    </li>
  );
}
