import { useEffect, useState } from "react";
import type { CorosLinkApi } from "../coroslink-api";
import {
  heartRateZoneModelFromProfile,
  type HeartRateZoneModel
} from "./heartRateZoneModel";

interface UseHeartRateZoneModelOptions {
  api: CorosLinkApi | null;
  corosConnected: boolean;
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
 * error here would also mean shouting over a start-up re-login.
 */
export function useHeartRateZoneModel({
  api,
  corosConnected
}: UseHeartRateZoneModelOptions): HeartRateZoneModel | null {
  const [model, setModel] = useState<HeartRateZoneModel | null>(null);

  useEffect(() => {
    if (!api || !corosConnected) {
      setModel(null);
      return;
    }

    let cancelled = false;

    void api
      .getCorosProfileSnapshot()
      .then((snapshot) => {
        if (!cancelled) {
          setModel(heartRateZoneModelFromProfile(snapshot.profile));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setModel(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [api, corosConnected]);

  return model;
}
