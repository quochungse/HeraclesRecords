import { t } from "../i18n/core";

/**
 * One scale for "how far back am I looking", and the words that go with it.
 *
 * Six screens asked that question and each answered it in its own words. The
 * same ninety days was "3 months" on Running and Strength, "90 days" on the
 * Data screen, and "Last 90 days" on the training map; thirty days was "30
 * days" in two places, "Last 30 days" in a third and "30d" in a fourth. None
 * of that was a decision — each screen was written on a different day, and a
 * label is the easiest thing in the world to type out again.
 *
 * It matters more than it looks. An athlete who learns "3 months" on Running
 * and then reads "90 days" on Data has to work out that they are the same
 * window; the two screens disagree about nothing except how they spell it.
 *
 * So the periods live here, each with one label, and a screen declares the
 * subset it supports rather than writing its own list. `null` days means the
 * whole history — an option, not the absence of one, which is why it is spelt
 * out rather than left to a missing value.
 */

export type PeriodDays = 7 | 28 | 90 | 180 | 365 | null;

export interface PeriodOption {
  days: PeriodDays;
  label: string;
  /** For prose — "in the last 3 months". Sentence case, no leading article. */
  phrase: string;
}

/**
 * Every period the app offers, in order. A screen takes a slice of this by id
 * rather than restating a label, so a screen cannot drift from the scale by
 * accident — only by editing this file, which is the point.
 */
export const PERIOD_SCALE: readonly PeriodOption[] = [
  {
    days: 7,
    get label() {
      return t("app.period.d7");
    },
    get phrase() {
      return t("app.period.d7.phrase");
    }
  },
  {
    days: 28,
    get label() {
      return t("app.period.d28");
    },
    get phrase() {
      return t("app.period.d28.phrase");
    }
  },
  {
    days: 90,
    get label() {
      return t("app.period.d90");
    },
    get phrase() {
      return t("app.period.d90.phrase");
    }
  },
  {
    days: 180,
    get label() {
      return t("app.period.d180");
    },
    get phrase() {
      return t("app.period.d180.phrase");
    }
  },
  {
    days: 365,
    get label() {
      return t("app.period.d365");
    },
    get phrase() {
      return t("app.period.d365.phrase");
    }
  },
  {
    days: null,
    get label() {
      return t("app.period.all");
    },
    get phrase() {
      return t("app.period.all.phrase");
    }
  }
];

/** The options for the days a screen supports, in scale order. */
export function periodOptions(
  days: readonly PeriodDays[]
): readonly PeriodOption[] {
  return PERIOD_SCALE.filter((option) => days.includes(option.days));
}

/** The label for a window, for a heading or a sentence that names it. */
export function periodLabel(days: PeriodDays): string {
  return PERIOD_SCALE.find((option) => option.days === days)?.label ?? t("app.period.all");
}

/**
 * Periods as `OptionGroup` takes them. The value is a string because that is
 * what an option value is everywhere else in the app; `periodDaysFromValue`
 * turns it back. "all" rather than "null" so a stored preference reads as a
 * choice rather than as a missing one.
 */
export function periodGroupOptions(
  days: readonly PeriodDays[]
): Array<{ value: string; label: string }> {
  // The label is a getter, not a copy: screens build these once at load, and a
  // copied label would stay in the language the app opened in.
  return periodOptions(days).map((option) => ({
    value: periodValue(option.days),
    get label() {
      return option.label;
    }
  }));
}

export function periodValue(days: PeriodDays): string {
  return days === null ? "all" : String(days);
}

export function periodDaysFromValue(value: string): PeriodDays {
  if (value === "all") return null;
  const days = Number(value);
  return (PERIOD_SCALE.find((option) => option.days === days)?.days ??
    null) as PeriodDays;
}
