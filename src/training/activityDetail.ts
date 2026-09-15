import type {
  TrainingHubActivity,
  TrainingHubActivityDetail
} from "../../electron/types";

/**
 * Whether a loaded detail is the one the selected activity asked for.
 *
 * The selection changes the instant a row is clicked; the payload lands
 * whenever it lands. Between the two, a screen holding both has the *previous*
 * session's detail beside the new session's name, and code that reads "we have
 * a detail" as "we have this detail" draws the old run's route, zones and
 * splits under the new run's title — with no loader, because something was
 * there.
 *
 * A detail with no id of its own is accepted rather than refused: COROS does
 * not always send one, and `mergeActivityDetailWithList` fills it from the list
 * row precisely so this check has something to compare. Refusing it would blank
 * the pane for an activity whose detail had arrived perfectly well.
 */
export function detailMatchesActivity(
  detail: TrainingHubActivityDetail | null,
  activity: TrainingHubActivity | null
): boolean {
  if (!detail) {
    return false;
  }

  if (!activity || detail.activityId === undefined) {
    return true;
  }

  return detail.activityId === activity.activityId;
}
