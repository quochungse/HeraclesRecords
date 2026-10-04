import { useEffect, useState } from "react";
import { useI18n } from "../i18n/useI18n";
import {
  getTimeOfDayGreeting,
  msUntilNextGreetingChange,
} from "../greetings";

export function useTimeOfDayGreeting(): string {
  // The state is a tick, not the words: a greeting kept in state would stay in
  // the language it was first written in. It is read again on every render,
  // which a language switch causes through useI18n.
  useI18n();
  const [, setTick] = useState(0);

  useEffect(() => {
    let timeoutId = 0;

    const scheduleNext = () => {
      timeoutId = window.setTimeout(() => {
        setTick((tick) => tick + 1);
        scheduleNext();
      }, msUntilNextGreetingChange());
    };

    scheduleNext();
    return () => window.clearTimeout(timeoutId);
  }, []);

  return getTimeOfDayGreeting();
}
