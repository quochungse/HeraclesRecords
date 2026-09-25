/**
 * One session inside a plan.
 *
 * Deliberately not a workout tile. A library workout is a thing you own, so
 * its row answers "what is this and how often have I used it". A plan session
 * answers "what am I being asked to do, and did I do it": it has a place in a
 * week, it may carry a planned figure with no structure behind it, and once the
 * plan is on the calendar it has an outcome.
 */
import { ChevronRight } from "lucide-react";
import type { UnitSystem } from "../../electron/types";
import { formatDistanceValue } from "../units/units";
import {
  formatPlannedDuration,
  statusLabel,
  statusTone,
  type PlanEntryFacts
} from "./planReaderModel";
import { sportChipStyle, sportTheme } from "./sportTheme";

interface PlanEntryRowProps {
  entry: PlanEntryFacts;
  unitSystem: UnitSystem;
  /** Opens the session. */
  onOpen?: (entryId: string) => void;
}

export function PlanEntryRow({ entry, unitSystem, onOpen }: PlanEntryRowProps) {
  const Icon = sportTheme(entry.sport).icon;
  /* Only a duration that is the whole session: a sum of the timed steps
     beside a distance reads as the session's length and is not. */
  const duration = entry.durationComplete
    ? formatPlannedDuration(entry.durationSeconds)
    : null;
  const distance = entry.distanceMeters
    ? formatDistanceValue(entry.distanceMeters, unitSystem, { digits: 1 })
    : null;
  const tone = statusTone(entry.status);
  const label = statusLabel(entry.status);

  /*
   * Only the figures the plan actually states. A session that names a
   * distance and no duration is a normal thing to write, and filling the gap
   * with a zero would be this screen inventing a target.
   */
  const figures = [
    duration,
    distance,
    entry.trainingLoad ? `${Math.round(entry.trainingLoad)} load` : null,
    entry.strengthSets ? `${entry.strengthSets} sets` : null
  ].filter((figure): figure is string => Boolean(figure));

  const content = (
    <>
      <span className="plan-entry-sport" aria-hidden="true">
        <Icon size={13} strokeWidth={2.2} />
      </span>
      <span className="plan-entry-name">{entry.title}</span>
      {figures.length ? (
        <span className="plan-entry-figures">
          {figures.map((figure) => (
            <b key={figure}>{figure}</b>
          ))}
        </span>
      ) : (
        /* No duration, no distance, no load: COROS served the session's name
           and nothing else. Saying so beats four dashes pretending to be data. */
        <span className="plan-entry-figures is-nil">No target set</span>
      )}
      {entry.stepCount ? (
        <span className="plan-entry-steps">{entry.stepCount} steps</span>
      ) : null}
      {label && tone ? (
        <em className="plan-entry-status" data-tone={tone}>
          {label}
        </em>
      ) : null}
    </>
  );

  if (!onOpen) {
    return (
      <li className="plan-entry" style={sportChipStyle(entry.sport)}>
        {content}
      </li>
    );
  }

  /*
   * The whole row is the button, not a chevron at its end: the row is the
   * session, and a target the width of a glyph is one the pointer has to hunt
   * for. The chevron stays as the sign that it opens.
   */
  return (
    <li className="plan-entry-slot" data-entry-id={entry.id}>
      <button
        type="button"
        className="plan-entry is-openable"
        style={sportChipStyle(entry.sport)}
        onClick={() => onOpen(entry.id)}
      >
        {content}
        <ChevronRight className="plan-entry-go" size={14} aria-hidden="true" />
      </button>
    </li>
  );
}
