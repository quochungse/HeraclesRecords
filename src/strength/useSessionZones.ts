import { useEffect, useState } from "react";
import type { StrengthSession, TrainingHubActivityZoneBucket } from "../../electron/types";
import type { HeraclesRecordsApi } from "../heraclesrecords-api";

/** What the zone panel reads off a session's COROS detail. */
export interface SessionZones {
  hrZones: TrainingHubActivityZoneBucket[];
  hrZoneType?: number;
}

/**
 * The COROS id of a session's recording, or none: a session only Hevy knows
 * has no watch behind it — the rule the header's Ask Coach follows.
 */
export function corosRecordingId(session: StrengthSession): string | undefined {
  return session.sourceIds?.coros ?? (session.source === "hevy" ? undefined : session.activityId);
}

/** Answers kept between selections, so going back to a session is instant. */
const kept = new Map<string, SessionZones | null>();

/**
 * A strength session's time in heart-rate zones, read from its COROS detail.
 *
 * The Strength screen is built from the sets alone, which is all its history
 * carries, so the zones are asked for only once a session is opened — the
 * request a run's page makes, served from the detail cache after the first
 * time. Null while it is on its way, for a session with no recording, and on
 * a failure, which is silent: nothing else on the session waits for this.
 */
export function useSessionZones(
  api: HeraclesRecordsApi | null,
  session: StrengthSession | undefined,
  enabled: boolean
): SessionZones | null {
  const activityId = enabled && session ? corosRecordingId(session) : undefined;
  const sportType = session?.sportType ?? 0;
  const [answer, setAnswer] = useState<{ id: string; zones: SessionZones | null } | null>(null);

  useEffect(() => {
    if (!api || !activityId) {
      return;
    }
    if (kept.has(activityId)) {
      setAnswer({ id: activityId, zones: kept.get(activityId) ?? null });
      return;
    }

    let cancelled = false;
    void api
      .getTrainingHubActivityDetail(activityId, sportType)
      .then((detail) => {
        const zones =
          detail.hrZones.length > 0
            ? {
                hrZones: detail.hrZones,
                ...(detail.hrZoneType !== undefined ? { hrZoneType: detail.hrZoneType } : {})
              }
            : null;
        kept.set(activityId, zones);
        if (!cancelled) {
          setAnswer({ id: activityId, zones });
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [api, activityId, sportType]);

  return activityId && answer?.id === activityId ? answer.zones : null;
}
