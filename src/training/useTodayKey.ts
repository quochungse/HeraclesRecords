import { useEffect, useState } from "react";
import { getLocalHappenDayKey } from "./formatters";

/**
 * Today's date key, re-read when the calendar day turns over.
 *
 * The app is left open overnight — it is a desktop app an athlete keeps in a
 * window — and every "is this in the past" question on a screen was answered
 * from a key read once. Yesterday kept its Today ring, today read as a future
 * day, and the drag guard went on refusing a day that had since become valid.
 * The timer is set to the next local midnight rather than an interval, so it
 * fires once per day and costs nothing in between.
 *
 * It re-arms off a counter, not off the key. A firing that reads back the same
 * key — the clock stepped, the timer came in early, the machine woke a moment
 * before midnight — changes no state, so an effect keyed on the key would not
 * re-run and nothing would ever schedule the next midnight again. The counter
 * always changes, so the loop cannot end in a way that leaves the screen stuck
 * on a date it read once.
 */
export function useTodayKey(): string {
  const [todayKey, setTodayKey] = useState(() => getLocalHappenDayKey());
  const [rollover, setRollover] = useState(0);

  useEffect(() => {
    const now = new Date();
    const nextMidnight = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 1
    );
    const timer = window.setTimeout(
      () => {
        setTodayKey(getLocalHappenDayKey());
        setRollover((current) => current + 1);
      },
      // A second past midnight, so the new key is certainly the new day.
      Math.max(1_000, nextMidnight.getTime() - now.getTime() + 1_000)
    );
    return () => window.clearTimeout(timer);
  }, [rollover]);

  return todayKey;
}
