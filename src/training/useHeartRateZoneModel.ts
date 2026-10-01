import { useEffect, useState } from "react";
import type { CorosProfile } from "../../electron/types";
import type { HeraclesRecordsApi } from "../heraclesrecords-api";
import {
  heartRateZoneModelFromProfile,
  type HeartRateZoneModel
} from "./heartRateZoneModel";

interface UseHeartRateZoneModelOptions {
  api: HeraclesRecordsApi | null;
  corosConnected: boolean;
}

export interface HeartRateZoneModelState {
  model: HeartRateZoneModel | null;
  /**
   * Whether `model` is the answer rather than the wait for one. A null model
   * means both "the profile has not come back yet" and "the account has none",
   * and a caller that falls back on the dashboard's LTHR zones must not do it
   * for the first: on an account scored on heart-rate reserve that fallback
   * draws a different population for the moment the request is in the air, and
   * the Running screen's efficiency headline changed number and meaning every
   * time the screen mounted.
   */
  settled: boolean;
  /**
   * The profile the model was read from, for a screen that wants another
   * threshold off the same answer — Cycling's FTP and weight — rather than a
   * second request for it. Null until it arrives, and on a failure.
   */
  profile: CorosProfile | null;
}

/**
 * The heart-rate zones the account is scored against, read off the Personal
 * profile. Served from the main process's hour-long profile cache, so the
 * Overview costs at most one `/account/query` an hour for them — and the write
 * on the Personal screen seeds that cache, so switching the model is picked up
 * the next time this mounts.
 *
 * A failure stays silent on purpose: the zones only label a chart, and the
 * caller has the dashboard's LTHR zones to fall back on. Surfacing a COROS
 * error here would also mean shouting over a start-up re-login. A failure does
 * settle, so a caller waiting on `settled` falls back rather than waits forever.
 */
export function useHeartRateZoneModel({
  api,
  corosConnected
}: UseHeartRateZoneModelOptions): HeartRateZoneModelState {
  // Null until the request this connection made has answered. Cleared on
  // disconnect, so a reconnect waits for its own answer instead of reading the
  // last one.
  const [answer, setAnswer] = useState<{
    model: HeartRateZoneModel | null;
    profile: CorosProfile | null;
  } | null>(null);
  const active = Boolean(api) && corosConnected;

  useEffect(() => {
    if (!api || !corosConnected) {
      setAnswer(null);
      return;
    }

    let cancelled = false;

    void api
      .getCorosProfileSnapshot()
      .then((snapshot) => {
        if (!cancelled) {
          setAnswer({
            model: heartRateZoneModelFromProfile(snapshot.profile),
            profile: snapshot.profile
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAnswer({ model: null, profile: null });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [api, corosConnected]);

  return {
    model: active ? (answer?.model ?? null) : null,
    settled: !active || answer !== null,
    profile: active ? (answer?.profile ?? null) : null
  };
}
