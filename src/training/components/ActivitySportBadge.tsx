import { Activity, Mountain, type LucideIcon } from "lucide-react";
import { workoutSportView } from "../../calendar/workoutSportIcons";
import { activityWorkoutSport } from "../askCoachAbout";
import { sportColorCategory } from "../sportColors";

/**
 * An activity's sport as the Calendar draws it: its own icon, in its colour —
 * on a grey disc where it leads a list row, bare where it sits in a line of
 * text. A hike has no workout sport, so it is read off the colour group it is
 * drawn in, as the Calendar's day cell does.
 */
function activityIcon(sportType: number | undefined): LucideIcon {
  const sport = activityWorkoutSport(sportType);
  if (sport) {
    return workoutSportView(sport).icon;
  }
  return sportColorCategory(sportType) === "hiking" ? Mountain : Activity;
}

export function ActivitySportBadge({
  sportType,
  label,
  size = "md"
}: {
  sportType: number | undefined;
  /** The sport's name, read out in place of the picture. */
  label?: string;
  /** `sm` sits bare in a line of text; `md` leads a list row, on its disc. */
  size?: "sm" | "md";
}) {
  const Icon = activityIcon(sportType);
  return (
    <span
      className={`activity-sport-badge is-${size}`}
      data-sport={sportColorCategory(sportType)}
      {...(label ? { role: "img", "aria-label": label, title: label } : { "aria-hidden": true })}
    >
      <Icon size={13} strokeWidth={1.75} aria-hidden="true" />
    </span>
  );
}
