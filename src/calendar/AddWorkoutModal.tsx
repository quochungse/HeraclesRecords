import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  Activity,
  Bike,
  BookmarkPlus,
  BookOpen,
  CalendarDays,
  CalendarPlus,
  Dumbbell,
  Footprints,
  ListTree,
  Mountain,
  Eye,
  PersonStanding,
  Search,
  Waves,
  X,
  Zap,
  type LucideIcon
} from "lucide-react";
import { OptionGroup } from "../components/OptionGroup";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import type {
  ManualActivityInput,
  PlanWorkoutEntryInput,
  TrainingHubLibraryWorkout,
  TrainingHubSportType,
  UnitSystem,
  WorkoutSwimStroke
} from "../../electron/types";
import type { CorosLinkApi } from "../coroslink-api";
import { SelectDropdown } from "../components/SelectDropdown";
import { useUnitSystem } from "../units/UnitSystemProvider";
import { RunnerIcon } from "../running/runnerIcon";
import {
  displayDistanceToMeters,
  distanceUnit,
  swimDistanceToMeters,
  swimDistanceUnit
} from "../units/units";
import { formatHappenDayLabel, getLocalHappenDayKey } from "../training/formatters";
import { dateFromKey } from "./dateUtils";
import {
  SWIM_STROKE_IDS,
  WORKOUT_SPORT_CAPABILITIES
} from "../../electron/workoutCapabilities";
import {
  BuilderSportIcon,
  WorkoutBuilderWorkspace,
  useWorkoutBuilder
} from "./WorkoutBuilder";
import {
  builderRowValidationMessage,
  builderSummaryRange,
  formatBuilderToken,
  rowToStep,
  rowToSteps,
  type BuilderRow
} from "./workoutBuilderRows";

type AddTab = "quick" | "library" | "builder" | "activity";

type UploadSport = ManualActivityInput["sport"];
type ActivityDistanceUnit = "km" | "m" | "none";

const ADD_TAB_ITEMS: Record<AddTab, { label: string; Icon: LucideIcon }> = {
  quick: { label: "Quick training", Icon: Zap },
  library: { label: "From library", Icon: BookOpen },
  builder: { label: "Structured", Icon: ListTree },
  activity: { label: "Log activity", Icon: Activity }
};

/**
 * The sports Quick offers.
 *
 * All three are a single distance step, which is the whole idea of the tab —
 * one session, one number, one target. Strength is deliberately absent: COROS
 * requires an exercise per step and measures it in reps or seconds, never
 * distance, so a "quick strength workout" is a different form with a different
 * validator. The Structured tab already is that form.
 */
const QUICK_SPORTS = ["run", "bike", "swim"] as const;
type QuickSport = (typeof QUICK_SPORTS)[number];

/**
 * What a Quick step can hold itself to.
 *
 * **COROS carries one intensity per step, not a set of them** — `intensity` on
 * a step is a single tagged value — so this is a choice of target rather than
 * a list to tick. The options differ per sport because COROS says so, not to
 * keep the form short: a ride has no pace (it has speed), and a pool swim has
 * no heart-rate, pace or cadence target at all, only a stroke.
 * `WORKOUT_SPORT_CAPABILITIES[sport].intensities` is the authority; these are
 * the subset that makes sense without a zone table in front of you, and
 * `builderRowValidationMessage` still has the final word before anything is
 * sent.
 */
type QuickTargetType =
  | "none"
  | "pace"
  | "heartRate"
  | "cadence"
  | "power"
  | "speed"
  | "swimStroke";

const QUICK_TARGETS: Readonly<Record<QuickSport, readonly QuickTargetType[]>> = {
  run: ["none", "pace", "heartRate", "cadence", "power"],
  bike: ["none", "speed", "heartRate", "cadence", "power"],
  swim: ["none", "swimStroke"]
};

const QUICK_TARGET_LABEL: Readonly<Record<QuickTargetType, string>> = {
  none: "Open",
  pace: "Pace",
  heartRate: "Heart rate",
  cadence: "Cadence",
  power: "Power",
  speed: "Speed",
  swimStroke: "Stroke"
};

/** A target that is a low-to-high band of plain numbers. */
const QUICK_RANGE_TARGETS: readonly QuickTargetType[] = [
  "heartRate",
  "cadence",
  "power",
  "speed"
];

const QUICK_DISTANCE_PRESETS: Readonly<Record<QuickSport, readonly number[]>> = {
  run: [5, 8, 10, 21.1],
  bike: [20, 40, 60, 100],
  swim: [400, 800, 1500, 2000]
};

const QUICK_DEFAULT_NAME: Readonly<Record<QuickSport, string>> = {
  run: "Quick Run",
  bike: "Quick Ride",
  swim: "Quick Swim"
};

function quickTargetUnit(
  target: QuickTargetType,
  sport: QuickSport,
  unitSystem: UnitSystem
): string {
  switch (target) {
    case "heartRate":
      return "bpm";
    case "cadence":
      return sport === "bike" ? "rpm" : "spm";
    case "power":
      return "W";
    case "speed":
      return unitSystem === "imperial" ? "mph" : "km/h";
    default:
      return "";
  }
}

/**
 * The pace field as the builder's validator and encoder expect it: a range,
 * carrying its unit.
 *
 * Quick takes a single pace because one number is what "quick" means, and a
 * held pace is a band of zero width. Widening it here rather than teaching the
 * shared validator a second shape keeps one spelling of a pace in the app.
 * Quick builds the same row the Structured tab does, so it splits its pace too.
 */
function quickRowPace(pace: string): { paceFast: string; paceSlow: string } {
  const bare = pace.trim().replace(/\/(km|mi)$/i, "");
  const [fast, slow] = bare.split("-").map((value) => value.trim());
  return { paceFast: fast ?? "", paceSlow: slow || fast || "" };
}

interface LogSportOption {
  id: string;
  label: string;
  uploadSport: UploadSport;
  distanceUnit: ActivityDistanceUnit;
  Icon: LucideIcon;
  sportType?: number;
}

const DEFAULT_LOG_SPORT_OPTION: LogSportOption = {
  id: "suggested-run",
  label: "Run",
  uploadSport: "run",
  distanceUnit: "km",
  Icon: RunnerIcon
};

function quickWorkoutDuration(
  displayDistance: number,
  pace: string,
  unitSystem: UnitSystem
): string | null {
  const paceMatch = pace.trim().match(/^(\d+):([0-5]\d)(?:-(?:\d+):(?:[0-5]\d))?(?:\/(km|mi))?/i);
  if (!Number.isFinite(displayDistance) || displayDistance <= 0 || !paceMatch) {
    return null;
  }

  const paceSeconds = Number(paceMatch[1]) * 60 + Number(paceMatch[2]);
  const paceUnit = paceMatch[3]?.toLowerCase() ?? distanceUnit(unitSystem);
  const secondsPerKm = paceUnit === "mi" ? paceSeconds / 1.609344 : paceSeconds;
  const distanceKm = displayDistanceToMeters(displayDistance, unitSystem) / 1000;
  const totalMinutes = Math.round(distanceKm * secondsPerKm / 60);
  if (totalMinutes < 60) {
    return `${totalMinutes} min`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours} hr ${minutes} min` : `${hours} hr`;
}

function isQuickPaceValid(pace: string): boolean {
  const value = pace.trim();
  return value === "" || /^\d+:[0-5]\d(?:-\d+:[0-5]\d)?(?:\/(?:km|mi))?$/i.test(value);
}

function normalizeQuickPace(pace: string, unitSystem: UnitSystem): string {
  const value = pace.trim();
  return /\/(?:km|mi)$/i.test(value)
    ? value
    : `${value}/${distanceUnit(unitSystem)}`;
}

const SUGGESTED_LOG_SPORT_OPTIONS: LogSportOption[] = [
  DEFAULT_LOG_SPORT_OPTION,
  { id: "suggested-ride", label: "Ride", uploadSport: "bike", distanceUnit: "km", Icon: Bike },
  { id: "suggested-walk", label: "Walk", uploadSport: "other", distanceUnit: "km", Icon: Footprints },
  { id: "suggested-hike", label: "Hike", uploadSport: "other", distanceUnit: "km", Icon: Mountain },
  { id: "suggested-swim", label: "Swim", uploadSport: "other", distanceUnit: "m", Icon: Waves },
  { id: "suggested-strength", label: "Strength", uploadSport: "other", distanceUnit: "none", Icon: Dumbbell },
  { id: "suggested-yoga", label: "Yoga", uploadSport: "other", distanceUnit: "none", Icon: PersonStanding },
  { id: "suggested-other", label: "Other", uploadSport: "other", distanceUnit: "none", Icon: Activity }
];

const RUN_TERMS = ["run", "running", "treadmill", "trail run", "track"];
const BIKE_TERMS = ["bike", "biking", "bicycle", "cycle", "cycling", "ride", "mtb", "gravel"];
const SWIM_TERMS = ["swim", "swimming"];
const WALK_TERMS = ["walk", "walking"];
const HIKE_TERMS = ["hike", "hiking", "trek", "trail"];
const ROW_TERMS = ["row", "rowing"];
const SKI_TERMS = ["ski", "skiing", "snowboard", "skate", "skating"];
const PADDLE_TERMS = ["kayak", "canoe", "paddle", "sup"];
const STATIONARY_TERMS = [
  "strength",
  "gym",
  "weight",
  "weights",
  "yoga",
  "pilates",
  "stretch",
  "mobility",
  "meditation",
  "cardio",
  "indoor",
  "fitness"
];

function normalizeSportLabel(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, " ");
}

function includesSportTerm(label: string, terms: string[]): boolean {
  return terms.some((term) => label.includes(term));
}

function inferUploadSport(label: string): UploadSport {
  const normalized = normalizeSportLabel(label);
  if (includesSportTerm(normalized, BIKE_TERMS)) {
    return "bike";
  }
  if (includesSportTerm(normalized, RUN_TERMS)) {
    return "run";
  }
  return "other";
}

function inferDistanceUnit(label: string): ActivityDistanceUnit {
  const normalized = normalizeSportLabel(label);
  if (includesSportTerm(normalized, SWIM_TERMS)) {
    return "m";
  }
  if (
    includesSportTerm(normalized, [
      ...RUN_TERMS,
      ...BIKE_TERMS,
      ...WALK_TERMS,
      ...HIKE_TERMS,
      ...ROW_TERMS,
      ...SKI_TERMS,
      ...PADDLE_TERMS
    ])
  ) {
    return "km";
  }
  if (includesSportTerm(normalized, STATIONARY_TERMS)) {
    return "none";
  }
  return "none";
}

function inferSportIcon(label: string): LucideIcon {
  const normalized = normalizeSportLabel(label);
  if (includesSportTerm(normalized, SWIM_TERMS)) {
    return Waves;
  }
  if (includesSportTerm(normalized, BIKE_TERMS)) {
    return Bike;
  }
  if (includesSportTerm(normalized, ["strength", "gym", "weight", "weights"])) {
    return Dumbbell;
  }
  if (includesSportTerm(normalized, ["yoga", "pilates", "stretch", "mobility"])) {
    return PersonStanding;
  }
  if (includesSportTerm(normalized, RUN_TERMS)) {
    return RunnerIcon;
  }
  if (includesSportTerm(normalized, WALK_TERMS)) {
    return Footprints;
  }
  if (includesSportTerm(normalized, HIKE_TERMS)) {
    return Mountain;
  }
  return Activity;
}

function createCorosLogSportOption(sportType: TrainingHubSportType): LogSportOption {
  const label = sportType.sportName.trim() || `Sport ${sportType.sportType}`;
  return {
    id: `coros-${sportType.sportType}-${normalizeSportLabel(label).replace(/[^a-z0-9]+/g, "-")}`,
    label,
    uploadSport: inferUploadSport(label),
    distanceUnit: inferDistanceUnit(label),
    Icon: inferSportIcon(label),
    sportType: sportType.sportType
  };
}

function describeLogSportOption(option: LogSportOption): string {
  if (option.distanceUnit === "m") {
    return "meters";
  }
  if (option.distanceUnit === "km") {
    return "distance";
  }
  return "time only";
}

interface AddWorkoutModalProps {
  api: CorosLinkApi;
  dateKey: string;
  sportTypes: TrainingHubSportType[];
  onClose: () => void;
  onScheduled: (message: string) => void;
  onError: (message: string | null) => void;
  /**
   * Opens a library workout to be read. Only the "From library" tab offers
   * it, and that tab is absent under `libraryOnly`, so a caller that only
   * creates workouts need not pass it.
   */
  onViewLibrary?: (programId: string) => void;
  libraryOnly?: boolean;
  /**
   * Another dialog is open over this one, so it waits rather than closing.
   * See `WorkoutLibraryModal`: the workout view opens from the library tab
   * and closes back to it, so both are mounted and only the top one may take
   * an Escape.
   */
  covered?: boolean;
}

export function AddWorkoutModal({
  api,
  dateKey,
  sportTypes,
  onClose,
  onScheduled,
  onError,
  onViewLibrary,
  libraryOnly = false,
  covered = false
}: AddWorkoutModalProps) {
  const { unitSystem } = useUnitSystem();
  const reducedMotion = useReducedMotion();
  const todayKey = getLocalHappenDayKey();
  // Logging makes no sense for a day that hasn't happened yet, and COROS
  // rejects scheduling in the past — so each side of "today" gets the
  // tab set (and default tab) that can actually succeed.
  const canLogActivity = !libraryOnly && dateKey <= todayKey;
  const canSchedule = dateKey >= todayKey;
  const [tab, setTab] = useState<AddTab>(libraryOnly ? "builder" : canSchedule ? "quick" : "activity");
  const [submitting, setSubmitting] = useState(false);

  // Quick training
  const [quickSport, setQuickSport] = useState<QuickSport>("run");
  const [quickName, setQuickName] = useState("");
  const [quickDistanceKm, setQuickDistanceKm] = useState("");
  const [quickTargetType, setQuickTargetType] = useState<QuickTargetType>("none");
  const [quickPace, setQuickPace] = useState("");
  const [quickTargetLow, setQuickTargetLow] = useState("");
  const [quickTargetHigh, setQuickTargetHigh] = useState("");
  const [quickStroke, setQuickStroke] = useState<WorkoutSwimStroke>("freestyle");
  const [quickSave, setQuickSave] = useState(false);

  // Library
  const [library, setLibrary] = useState<TrainingHubLibraryWorkout[] | null>(null);
  const [libraryFilter, setLibraryFilter] = useState("");
  const [selectedProgramId, setSelectedProgramId] = useState<string | null>(null);

  // Log activity
  const [activitySportId, setActivitySportId] = useState(DEFAULT_LOG_SPORT_OPTION.id);
  const [activitySportSearch, setActivitySportSearch] = useState("");
  const [activitySportSearchOpen, setActivitySportSearchOpen] = useState(false);
  const [activityTime, setActivityTime] = useState(() =>
    dateKey === todayKey
      ? new Date(Date.now() - 3_600_000).toTimeString().slice(0, 5)
      : "12:00"
  );
  const [activityHours, setActivityHours] = useState("");
  const [activityMinutes, setActivityMinutes] = useState("");
  const [activityDistance, setActivityDistance] = useState("");
  const [activityCalories, setActivityCalories] = useState("");
  const [activityAvgHr, setActivityAvgHr] = useState("");

  // Builder — the Structured tab's state lives in the builder's own hook, so
  // it survives a visit to another tab exactly as it did when it lived here.
  const builder = useWorkoutBuilder(api);
  const {
    builderSport,
    builderPoolLength,
    setBuilderPoolLength,
    builderPoolUnit,
    builderGradeSystem,
    builderName,
    builderDescription,
    rows,
    builderValid,
    builderSportMeta
  } = builder;
  const [builderSave, setBuilderSave] = useState(true);

  useEffect(() => {
    if (covered) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submitting) onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [covered, onClose, submitting]);

  useEffect(() => {
    if (tab !== "library" || library !== null) {
      return;
    }
    void api
      .listLibraryWorkouts()
      .then(setLibrary)
      .catch((cause: unknown) => {
        setLibrary([]);
        onError(cause instanceof Error ? cause.message : String(cause));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  /* A target belongs to a sport: a ride has no pace and a pool swim has none
     of pace, heart rate or cadence. Changing sport with an impossible target
     still selected would send a step COROS refuses, so it falls back to Open
     rather than silently keeping a value that no longer applies. */
  useEffect(() => {
    setQuickTargetType((current) =>
      QUICK_TARGETS[quickSport].includes(current) ? current : "none"
    );
  }, [quickSport]);

  const filteredLibrary = useMemo(() => {
    const query = libraryFilter.trim().toLowerCase();
    const items = library ?? [];
    if (!query) {
      return items;
    }
    return items.filter((item) => item.name.toLowerCase().includes(query));
  }, [library, libraryFilter]);

  const corosSportOptions = useMemo(() => {
    const seen = new Set<string>();
    return sportTypes
      .map(createCorosLogSportOption)
      .filter((option) => {
        const key = normalizeSportLabel(option.label);
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      });
  }, [sportTypes]);

  // One catalog: curated options first (stable defaults), then every COROS
  // sport type that doesn't duplicate a curated label.
  const combinedSportOptions = useMemo(() => {
    const seen = new Set<string>();
    const combined: LogSportOption[] = [];
    for (const option of [...SUGGESTED_LOG_SPORT_OPTIONS, ...corosSportOptions]) {
      const key = normalizeSportLabel(option.label);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      combined.push(option);
    }
    return combined;
  }, [corosSportOptions]);

  const selectedActivitySport =
    combinedSportOptions.find((option) => option.id === activitySportId) ??
    DEFAULT_LOG_SPORT_OPTION;

  const visibleSportOptions = useMemo(() => {
    const query = normalizeSportLabel(activitySportSearch);
    if (query) {
      return combinedSportOptions
        .filter((option) => normalizeSportLabel(option.label).includes(query))
        .slice(0, 12);
    }

    const defaults = combinedSportOptions.slice(
      0,
      SUGGESTED_LOG_SPORT_OPTIONS.length
    );
    // Keep a selection made through search visible after the query is cleared.
    if (!defaults.some((option) => option.id === selectedActivitySport.id)) {
      return [selectedActivitySport, ...defaults];
    }
    return defaults;
  }, [activitySportSearch, combinedSportOptions, selectedActivitySport]);

  const showActivityDistance = selectedActivitySport.distanceUnit !== "none";
  const activityDistanceUnit =
    selectedActivitySport.distanceUnit === "m"
      ? swimDistanceUnit(unitSystem)
      : distanceUnit(unitSystem);

  const run = async (action: () => Promise<void>, successMessage: string) => {
    setSubmitting(true);
    try {
      await action();
      onScheduled(successMessage);
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSubmitting(false);
    }
  };

  const submitQuick = () =>
    run(async () => {
      const entry: PlanWorkoutEntryInput = {
        key: "calendar-quick",
        name: quickName.trim() || QUICK_DEFAULT_NAME[quickSport],
        sport: quickSport,
        // A pool swim is measured in lengths, so COROS needs the pool before
        // it can turn a distance into a workout.
        ...(quickSport === "swim"
          ? {
              sport_options: {
                poolLength: {
                  value: Number(builderPoolLength),
                  unit: builderPoolUnit
                }
              }
            }
          : {}),
        steps: [rowToStep(quickRow, quickSport, unitSystem)]
      };
      await api.createAndScheduleWorkout(entry, dateKey, unitSystem, quickSave);
    }, `Scheduled "${quickName.trim() || QUICK_DEFAULT_NAME[quickSport]}" on ${formatHappenDayLabel(dateKey)}.`);

  const submitLibrary = () =>
    run(async () => {
      if (!selectedProgramId) {
        throw new Error("Pick a workout from your library first.");
      }
      await api.scheduleLibraryWorkout(selectedProgramId, dateKey);
    }, `Workout scheduled on ${formatHappenDayLabel(dateKey)}.`);

  const submitBuilder = () =>
    run(async () => {
      const entry: PlanWorkoutEntryInput = {
        key: "calendar-builder",
        name: builderName.trim() || "Structured Workout",
        ...(builderDescription.trim() ? { description: builderDescription.trim() } : {}),
        sport: builderSport,
        ...((builderSport === "swim")
          ? { sport_options: { poolLength: { value: Number(builderPoolLength), unit: builderPoolUnit } } }
          : (builderSport === "indoorClimb" || builderSport === "bouldering")
            ? { sport_options: { gradingSystem: builderGradeSystem } }
            : {}),
        steps: rows.flatMap((row) => rowToSteps(row, builderSport, unitSystem))
      };
      if (libraryOnly) {
        await api.createLibraryWorkout(entry, unitSystem);
      } else {
        await api.createAndScheduleWorkout(entry, dateKey, unitSystem, builderSave);
      }
    }, libraryOnly
      ? `Saved "${builderName.trim() || "Structured Workout"}" to the Workout Library.`
      : `Scheduled "${builderName.trim() || "Structured Workout"}" on ${formatHappenDayLabel(dateKey)}.`);

  const submitActivity = () =>
    run(async () => {
      const [hourPart, minutePart] = activityTime.split(":").map(Number);
      const start = dateFromKey(dateKey);
      start.setHours(hourPart || 0, minutePart || 0, 0, 0);
      const durationSec = Math.round(
        (Number(activityHours) || 0) * 3600 + (Number(activityMinutes) || 0) * 60
      );
      const calories = Number(activityCalories);
      const avgHr = Number(activityAvgHr);
      const distanceM =
        selectedActivitySport.distanceUnit === "m"
          ? Math.round(
              swimDistanceToMeters(Number(activityDistance) || 0, unitSystem)
            )
          : selectedActivitySport.distanceUnit === "km"
            ? Math.round(
                displayDistanceToMeters(Number(activityDistance) || 0, unitSystem)
              )
            : 0;
      const input: ManualActivityInput = {
        sport: selectedActivitySport.uploadSport,
        startTimeIso: start.toISOString(),
        durationSec,
        distanceM,
        ...(calories > 0 ? { calories } : {}),
        ...(avgHr > 0 ? { avgHr } : {})
      };
      await api.addManualActivityToCoros(input);
    }, `Activity logged on ${formatHappenDayLabel(dateKey)}. COROS may take a moment to show it.`);

  const quickDistance = Number(quickDistanceKm);
  const quickDistanceValid = Number.isFinite(quickDistance) && quickDistance > 0;
  const quickPaceValid = isQuickPaceValid(quickPace);
  const quickPaceLabel = quickPace.trim()
    ? normalizeQuickPace(quickPace, unitSystem)
    : "";
  /* A pool swim is measured in lengths, so its distance is metres or yards
     while a run and a ride are kilometres or miles. */
  const quickDistanceUnitLabel =
    quickSport === "swim" ? swimDistanceUnit(unitSystem) : distanceUnit(unitSystem);
  const quickTargets = QUICK_TARGETS[quickSport];
  const quickIsRangeTarget = QUICK_RANGE_TARGETS.includes(quickTargetType);
  const quickTargetUnitLabel = quickTargetUnit(
    quickTargetType,
    quickSport,
    unitSystem
  );

  /*
   * Quick builds the same `BuilderRow` the Structured tab does, so the one
   * encoder (`rowToStep`) and the one validator (`builderRowValidationMessage`)
   * cover both. A second, simpler encoder beside them is how the two tabs
   * would start disagreeing about what a pace or a cadence means.
   */
  const quickRow = useMemo<BuilderRow>(
    () => ({
      id: 0,
      kind: "training",
      targetType: "distance",
      targetValue: quickDistanceKm,
      ...quickRowPace(quickTargetType === "pace" ? quickPace : ""),
      repeats: "1",
      sets: "1",
      restSeconds: "0",
      intensityType: quickTargetType === "none" ? "none" : quickTargetType,
      intensityLow: quickTargetLow,
      intensityHigh: quickTargetHigh || quickTargetLow,
      intensityPreset: quickTargetType === "swimStroke" ? quickStroke : "",
      intensityBasis: "maxHr",
      intensityUnit:
        quickTargetType === "speed"
          ? unitSystem === "imperial"
            ? "mph"
            : "km/h"
          : quickSport === "bike"
            ? "rpm"
            : "spm",
      exerciseName: "",
      exerciseId: ""
    }),
    [
      quickDistanceKm,
      quickPace,
      quickSport,
      quickStroke,
      quickTargetHigh,
      quickTargetLow,
      quickTargetType,
      unitSystem
    ]
  );

  /** The chosen target as one phrase, for the preview and the step line. */
  const quickTargetSummary = ((): string => {
    if (quickTargetType === "none") {
      return "Open";
    }
    if (quickTargetType === "pace") {
      return quickPace.trim() && quickPaceValid ? quickPaceLabel : "Not set";
    }
    if (quickTargetType === "swimStroke") {
      return formatBuilderToken(quickStroke);
    }
    return Number(quickTargetLow) > 0
      ? builderSummaryRange(quickTargetLow, quickTargetHigh, quickTargetUnitLabel)
      : "Not set";
  })();

  /**
   * The first thing standing between this form and COROS, in plain words.
   *
   * The distance and the target are checked here because they are what this
   * tab asks for; everything past them is handed to the shared validator, so
   * Quick cannot accept a step the Structured tab would refuse.
   */
  const quickProblem = ((): string | undefined => {
    if (!quickDistanceValid) {
      return "Enter a distance to enable scheduling.";
    }
    if (quickTargetType === "pace") {
      if (!quickPace.trim()) {
        return "Enter the pace to hold, or set the target to Open.";
      }
      if (!quickPaceValid) {
        return "Correct the pace format to continue.";
      }
    }
    if (quickIsRangeTarget && !(Number(quickTargetLow) > 0)) {
      return `Enter the ${QUICK_TARGET_LABEL[quickTargetType].toLocaleLowerCase()} to hold, or set the target to Open.`;
    }
    return builderRowValidationMessage(quickRow, quickSport, [], false, unitSystem);
  })();
  const quickValid = !quickProblem;
  const activityValid =
    activityTime.trim() !== "" &&
    (Number(activityHours) || 0) * 60 + (Number(activityMinutes) || 0) > 0;
  /* Only a pace target implies a duration, and only this tab's current target
     counts: `quickPace` survives a change of target and a change of sport, so
     reading it unconditionally put a run's pace on a ride ("about 3 hr 40 min"
     for a workout carrying no pace at all) and read a swim's 1500 m as 1500 km. */
  const quickDuration =
    quickTargetType === "pace" && quickPaceValid
      ? quickWorkoutDuration(quickDistance, quickPace, unitSystem)
      : null;
  const availableTabs: AddTab[] = libraryOnly ? ["builder"] : [
    ...(canSchedule ? (["quick", "library", "builder"] as AddTab[]) : []),
    ...(canLogActivity ? (["activity"] as AddTab[]) : [])
  ];

  return createPortal(
    <AnimatePresence>
      <motion.div
        className="calendar-modal-backdrop"
        inert={covered}
        initial={reducedMotion ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={reducedMotion ? { opacity: 1 } : { opacity: 0 }}
      >
        {/* No close on a press outside the sheet. Building a workout is
            minutes of input, and a click that lands a pixel past the edge —
            or a drag that starts inside and ends outside — threw all of it
            away. The header's close button and Escape are the ways out. */}
        <motion.div
          className={`calendar-modal calendar-modal-workspace calendar-modal-${tab} panel`}
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-calendar-title"
          style={tab === "builder"
            ? { "--builder-sport": builderSportMeta.colorVar } as CSSProperties
            : undefined}
          initial={reducedMotion ? false : { opacity: 0, y: 18, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={reducedMotion ? { opacity: 1, y: 0, scale: 1 } : { opacity: 0, y: 18, scale: 0.98 }}
          transition={reducedMotion ? { duration: 0 } : { type: "spring", stiffness: 360, damping: 30 }}
          onClick={(event) => event.stopPropagation()}
        >
          <header className="calendar-modal-header">
            {/* A library workout has no day to state, and "Reusable workout"
                over "Create library workout" said the same thing twice — so
                the title stands alone there, in the accent the date line
                wears for a calendar day. */}
            <div>
              {libraryOnly ? null : (
                <p className="calendar-modal-date">
                  <CalendarDays size={13} aria-hidden="true" />
                  {formatHappenDayLabel(dateKey)}
                </p>
              )}
              <h3
                id="add-calendar-title"
                className={libraryOnly ? "is-library" : undefined}
              >
                {libraryOnly ? "Create library workout" : "Add to calendar"}
              </h3>
            </div>
            <button
              type="button"
              className="ghost-button calendar-modal-close"
              onClick={onClose}
              aria-label="Close"
            >
              <X size={16} aria-hidden="true" />
            </button>
          </header>

          {/* One tab is not a choice: a tablist with a single tab is a label
              that looks like a control. It comes back the moment a second
              destination is on offer. */}
          {availableTabs.length > 1 ? <div className="calendar-modal-tabs" role="tablist" aria-label={libraryOnly ? "Workout creation method" : "Add to calendar method"}>
            {availableTabs.map((id) => {
              const { label, Icon } = ADD_TAB_ITEMS[id];
              return (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={tab === id}
                  className={`calendar-modal-tab ${tab === id ? "is-active" : ""}`}
                  onClick={() => setTab(id)}
                >
                  <Icon size={14} aria-hidden="true" />
                  {label}
                </button>
              );
            })}
          </div> : null}

          {tab === "quick" ? (
            <form
              className="calendar-modal-body calendar-quick-body"
              onSubmit={(event) => {
                event.preventDefault();
                if (quickValid && !submitting) void submitQuick();
              }}
            >
              <div className="calendar-quick-settings">
                <div className="calendar-quick-intro">
                  <h4>Workout settings</h4>
                  <p>One distance, one target.</p>
                </div>

                <div className="calendar-quick-fields">
                  <div className="calendar-field calendar-quick-wide">
                    <span className="calendar-field-label">
                      <span>Sport</span>
                    </span>
                    <OptionGroup
                      label="Workout sport"
                      fill
                      size="md"
                      value={quickSport}
                      options={QUICK_SPORTS.map((sport) => ({
                        value: sport,
                        label: WORKOUT_SPORT_CAPABILITIES[sport].label,
                        icon: (
                          <BuilderSportIcon sport={sport} />
                        )
                      }))}
                      onChange={setQuickSport}
                    />
                  </div>

                  <label className="calendar-field calendar-quick-name calendar-quick-wide">
                    <span className="calendar-field-label">
                      <span>Workout name</span>
                      <small>Optional</small>
                    </span>
                    <input
                      type="text"
                      value={quickName}
                      onChange={(event) => setQuickName(event.target.value)}
                      placeholder={QUICK_DEFAULT_NAME[quickSport]}
                    />
                  </label>

                  <label className="calendar-field calendar-quick-wide">
                    <span className="calendar-field-label">
                      <span>Distance</span>
                      <small>Required</small>
                    </span>
                    <span className="calendar-quick-input">
                      <input
                        type="number"
                        min="0"
                        step={quickSport === "swim" ? "25" : "0.1"}
                        inputMode="decimal"
                        value={quickDistanceKm}
                        onChange={(event) => setQuickDistanceKm(event.target.value)}
                        placeholder={quickSport === "swim" ? "1500" : "8.0"}
                        aria-label={`Distance in ${quickDistanceUnitLabel}`}
                        required
                      />
                      <span aria-hidden="true">{quickDistanceUnitLabel}</span>
                    </span>
                    <OptionGroup
                      label="Common distances"
                      className="calendar-quick-presets"
                      tone="quiet"
                      value={
                        Number.isFinite(quickDistance) ? String(quickDistance) : ""
                      }
                      options={QUICK_DISTANCE_PRESETS[quickSport].map((distance) => ({
                        value: String(distance),
                        label: `${distance} ${quickDistanceUnitLabel}`
                      }))}
                      onChange={(next) => setQuickDistanceKm(next)}
                    />
                  </label>

                  {quickSport === "swim" ? (
                    <label className="calendar-field calendar-quick-wide">
                      <span className="calendar-field-label">
                        <span>Pool length</span>
                        <small>From your COROS profile</small>
                      </span>
                      <span className="calendar-quick-input">
                        <input
                          type="number"
                          min="1"
                          value={builderPoolLength}
                          onChange={(event) => setBuilderPoolLength(event.target.value)}
                        />
                        <span aria-hidden="true">{swimDistanceUnit(unitSystem)}</span>
                      </span>
                    </label>
                  ) : null}

                  <div className="calendar-field calendar-quick-wide">
                    <span className="calendar-field-label">
                      <span>Target</span>
                      <small>Optional</small>
                    </span>
                    {/* The kind of target and the figure to hold share a row.
                        Stacked, the two controls plus their hint came to 133px
                        in a 431px column and pushed the figure below the fold
                        of the very form it belongs to. */}
                    <div className="calendar-quick-target-row">
                      {/* Portalled like every other dropdown in this modal.
                          The settings column is a scroll container, and an
                          absolutely positioned menu still counts towards its
                          scrollable overflow — so opening the list grew the
                          column's content, raised a scrollbar, narrowed the
                          column and reflowed every field in it. The menu
                          appearing is not a layout change. */}
                      <SelectDropdown
                        label="Workout target"
                        value={quickTargetType}
                        options={quickTargets.map((target) => ({
                          value: target,
                          label: QUICK_TARGET_LABEL[target]
                        }))}
                        portal
                        onChange={(next) => setQuickTargetType(next as QuickTargetType)}
                      />

                      {quickTargetType === "pace" ? (
                        <span className={`calendar-quick-input ${quickPaceValid ? "" : "has-error"}`}>
                          <input
                            type="text"
                            value={quickPace}
                            onChange={(event) => setQuickPace(event.target.value)}
                            placeholder="5:30"
                            aria-label={`Target pace per ${unitSystem === "imperial" ? "mile" : "kilometre"}`}
                            aria-invalid={!quickPaceValid}
                          />
                          <span aria-hidden="true">/{distanceUnit(unitSystem)}</span>
                        </span>
                      ) : null}

                      {quickIsRangeTarget ? (
                        <>
                          <span className="calendar-quick-input">
                            <input
                              type="number"
                              min="0"
                              inputMode="decimal"
                              value={quickTargetLow}
                              onChange={(event) => setQuickTargetLow(event.target.value)}
                              placeholder="Low"
                              aria-label={`${QUICK_TARGET_LABEL[quickTargetType]} low`}
                            />
                            <span aria-hidden="true">{quickTargetUnitLabel}</span>
                          </span>
                          <span className="calendar-quick-input">
                            <input
                              type="number"
                              min="0"
                              inputMode="decimal"
                              value={quickTargetHigh}
                              onChange={(event) => setQuickTargetHigh(event.target.value)}
                              placeholder="High"
                              aria-label={`${QUICK_TARGET_LABEL[quickTargetType]} high`}
                            />
                            <span aria-hidden="true">{quickTargetUnitLabel}</span>
                          </span>
                        </>
                      ) : null}

                      {quickTargetType === "swimStroke" ? (
                        <SelectDropdown
                          label="Swim stroke"
                          value={quickStroke}
                          options={Object.keys(SWIM_STROKE_IDS).map((stroke) => ({
                            value: stroke,
                            label: formatBuilderToken(stroke)
                          }))}
                          portal
                          onChange={(next) => setQuickStroke(next as WorkoutSwimStroke)}
                        />
                      ) : null}
                    </div>

                    {quickTargetType === "pace" ? (
                      <small className={`calendar-field-help ${quickPaceValid ? "" : "is-error"}`}>
                        {quickPaceValid
                          ? "One pace to hold, or a range like 5:20-5:40."
                          : "Enter pace as minutes:seconds, for example 5:30."}
                      </small>
                    ) : null}

                    {quickIsRangeTarget ? (
                      <small className="calendar-field-help">
                        Leave the high value empty to hold a single figure.
                      </small>
                    ) : null}
                  </div>
                </div>

              </div>

              <section className="calendar-quick-preview" aria-labelledby="calendar-quick-preview-title" aria-live="polite">
                <header className="calendar-quick-preview-header">
                  <div>
                    <h4 id="calendar-quick-preview-title">Workout preview</h4>
                    <p>{formatHappenDayLabel(dateKey)}</p>
                  </div>
                  <span className={quickValid ? "is-ready" : ""}>
                    {quickValid ? "Ready" : "In progress"}
                  </span>
                </header>

                <div className="calendar-quick-preview-title">
                  <span aria-hidden="true"><BuilderSportIcon sport={quickSport} size={20} /></span>
                  <div>
                    <strong>{quickName.trim() || QUICK_DEFAULT_NAME[quickSport]}</strong>
                    <small>Distance workout</small>
                  </div>
                </div>

                <dl className="calendar-quick-preview-metrics">
                  <div>
                    <dt>Distance</dt>
                    <dd>{quickDistanceValid ? `${quickDistance.toLocaleString()} ${quickDistanceUnitLabel}` : "-"}</dd>
                  </div>
                  <div>
                    {/* "Open" is the value, so it cannot also be the label. */}
                    <dt>
                      {quickTargetType === "none"
                        ? "Target"
                        : QUICK_TARGET_LABEL[quickTargetType]}
                    </dt>
                    <dd>{quickTargetSummary}</dd>
                  </div>
                  <div>
                    <dt>Estimated time</dt>
                    <dd>{quickDuration ?? "-"}</dd>
                  </div>
                </dl>

                <label className={`calendar-quick-save ${quickSave ? "is-checked" : ""}`}>
                  <input
                    type="checkbox"
                    checked={quickSave}
                    onChange={(event) => setQuickSave(event.target.checked)}
                  />
                  <BookmarkPlus size={18} aria-hidden="true" />
                  <span>
                    <strong>Save to workout library</strong>
                    <small>Keep a reusable copy after scheduling.</small>
                  </span>
                </label>

                <div className="calendar-quick-preview-step">
                  <span aria-hidden="true">1</span>
                  <div>
                    <strong>{WORKOUT_SPORT_CAPABILITIES[quickSport].label}</strong>
                    <small>
                      {quickDistanceValid ? `${quickDistance.toLocaleString()} ${quickDistanceUnitLabel}` : "Set a distance"}
                      {quickTargetType === "none"
                        ? " at open effort"
                        : ` at ${quickTargetSummary.toLocaleLowerCase()}`}
                    </small>
                  </div>
                </div>
              </section>

              <footer className="calendar-modal-footer">
                <div className="calendar-quick-summary" aria-live="polite">
                  {quickValid ? (
                    <>
                      <span>Workout total</span>
                      <strong>
                        {quickDistance.toLocaleString()} {quickDistanceUnitLabel}
                        {quickDuration ? `, about ${quickDuration}` : ""}
                      </strong>
                    </>
                  ) : (
                    <span>{quickProblem}</span>
                  )}
                </div>
                <button
                  type="submit"
                  className="primary-button"
                  disabled={!quickValid || submitting}
                >
                  <CalendarPlus size={16} aria-hidden="true" />
                  {submitting ? "Scheduling…" : "Schedule workout"}
                </button>
              </footer>
            </form>
          ) : null}

          {tab === "library" ? (
            <div className="calendar-modal-body calendar-library-body">
              <label className="calendar-field">
                <span>Search</span>
                <input
                  type="text"
                  value={libraryFilter}
                  onChange={(event) => setLibraryFilter(event.target.value)}
                  placeholder="Filter workouts…"
                />
              </label>
              <div className="calendar-library-list">
                {library === null ? (
                  <p className="calendar-detail-empty">Loading library…</p>
                ) : filteredLibrary.length === 0 ? (
                  <p className="calendar-detail-empty">No workouts in your library.</p>
                ) : (
                  filteredLibrary.map((item) => (
                    <div key={item.id} className={`calendar-library-item-row ${selectedProgramId === item.id ? "is-selected" : ""}`}>
                      <button
                        type="button"
                        className="calendar-library-item"
                        onClick={() => setSelectedProgramId(item.id)}
                      >
                        <span className="calendar-chip-name">{item.name}</span>
                        <span className="calendar-chip-meta">
                          {[item.volume, item.trainingLoad !== undefined ? `${Math.round(item.trainingLoad)} TL` : null]
                            .filter(Boolean)
                            .join(" · ") || "No calculated totals"}
                        </span>
                      </button>
                      {onViewLibrary && item.sportType && item.sportType >= 1 && item.sportType <= 9 ? (
                        <button type="button" className="ghost-button calendar-library-edit" onClick={() => onViewLibrary(item.id)}>
                          <Eye size={13} aria-hidden="true" /> View
                        </button>
                      ) : (
                        <span className="calendar-library-readonly">No preview</span>
                      )}
                    </div>
                  ))
                )}
              </div>
              <footer className="calendar-modal-footer">
                <button
                  type="button"
                  className="primary-button"
                  disabled={!selectedProgramId || submitting}
                  onClick={() => void submitLibrary()}
                >
                  {submitting ? "Scheduling…" : "Schedule"}
                </button>
              </footer>
            </div>
          ) : null}

          {tab === "builder" ? (
            <WorkoutBuilderWorkspace
              builder={builder}
              settingsExtra={libraryOnly ? null : (
                <label className={`calendar-builder-save-card ${builderSave ? "is-checked" : ""}`}>
                  <input
                    type="checkbox"
                    role="switch"
                    checked={builderSave}
                    onChange={(event) => setBuilderSave(event.target.checked)}
                    aria-describedby="calendar-builder-save-help"
                  />
                  <span className="calendar-builder-save-icon" aria-hidden="true">
                    <BookmarkPlus size={17} />
                  </span>
                  <span className="calendar-builder-save-copy">
                    <strong>Save to library</strong>
                    <small id="calendar-builder-save-help">Keep a reusable copy after scheduling.</small>
                  </span>
                  <span className="calendar-builder-save-switch" aria-hidden="true">
                    <span />
                  </span>
                </label>
              )}
              footerLead={libraryOnly ? null : (
                <label className="calendar-check calendar-builder-footer-save">
                  <input
                    type="checkbox"
                    checked={builderSave}
                    onChange={(event) => setBuilderSave(event.target.checked)}
                  />
                  Also save to workout library
                </label>
              )}
              action={
                <button
                  type="button"
                  className="primary-button"
                  disabled={!builderValid || submitting}
                  onClick={() => void submitBuilder()}
                >
                  {libraryOnly ? <BookmarkPlus size={16} aria-hidden="true" /> : <CalendarPlus size={16} aria-hidden="true" />}
                  {submitting ? (libraryOnly ? "Saving…" : "Scheduling…") : (libraryOnly ? "Save workout" : "Schedule workout")}
                </button>
              }
            />
          ) : null}

          {tab === "activity" ? (
            <div className="calendar-modal-body calendar-activity-body">
              <section
                className="calendar-activity-section calendar-activity-sport-picker"
                role="group"
                aria-label="Activity type"
              >
                <div className="calendar-activity-section-head">
                  <h4>Activity type</h4>
                  <button
                    type="button"
                    className="calendar-activity-search-toggle"
                    aria-expanded={activitySportSearchOpen}
                    disabled={submitting}
                    onClick={() => {
                      setActivitySportSearchOpen((open) => {
                        if (open) setActivitySportSearch("");
                        return !open;
                      });
                    }}
                  >
                    <Search size={12} aria-hidden="true" />
                    {activitySportSearchOpen ? "Hide search" : "Search all types"}
                  </button>
                </div>

                {activitySportSearchOpen ? (
                  <span className="calendar-sport-search-control">
                    <Search size={14} aria-hidden="true" />
                    <input
                      type="text"
                      aria-label="Search activity types"
                      value={activitySportSearch}
                      onChange={(event) => setActivitySportSearch(event.target.value)}
                      placeholder="Rowing, pilates, indoor bike…"
                      disabled={submitting}
                      autoFocus
                    />
                  </span>
                ) : null}

                {visibleSportOptions.length === 0 ? (
                  <p className="calendar-activity-hint">
                    No activity types match that search.
                  </p>
                ) : (
                  <div className="calendar-sport-grid">
                    {visibleSportOptions.map((option) => {
                      const Icon = option.Icon;
                      return (
                        <button
                          key={option.id}
                          type="button"
                          aria-pressed={selectedActivitySport.id === option.id}
                          className={`calendar-sport-card ${selectedActivitySport.id === option.id ? "is-active" : ""}`}
                          onClick={() => setActivitySportId(option.id)}
                          disabled={submitting}
                          title={describeLogSportOption(option)}
                        >
                          <Icon size={14} aria-hidden="true" />
                          <span>{option.label}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </section>

              <section className="calendar-activity-section">
                <h4>When and how long</h4>
                <div className="calendar-field-row">
                  <label className="calendar-field">
                    <span>Started at</span>
                    <input
                      type="time"
                      value={activityTime}
                      onChange={(event) => setActivityTime(event.target.value)}
                      disabled={submitting}
                    />
                  </label>
                  <div className="calendar-field">
                    <span>Duration</span>
                    <div className="calendar-duration-control">
                      <span className="calendar-duration-part">
                        <input
                          type="number"
                          min="0"
                          max="23"
                          aria-label="Duration, hours"
                          value={activityHours}
                          onChange={(event) => setActivityHours(event.target.value)}
                          placeholder="0"
                          disabled={submitting}
                        />
                        <em>h</em>
                      </span>
                      <span className="calendar-duration-part">
                        <input
                          type="number"
                          min="0"
                          max="59"
                          aria-label="Duration, minutes"
                          value={activityMinutes}
                          onChange={(event) => setActivityMinutes(event.target.value)}
                          placeholder="0"
                          disabled={submitting}
                        />
                        <em>m</em>
                      </span>
                    </div>
                  </div>
                </div>
              </section>

              {/* Everything below is recalled rather than measured, so the
                  heading says so once instead of tagging each field. */}
              <section className="calendar-activity-section">
                <h4>If you know them</h4>
                <div className="calendar-field-row">
                  {showActivityDistance ? (
                    <label className="calendar-field">
                      <span>Distance</span>
                      <span className="calendar-unit-control">
                        <input
                          type="number"
                          min="0"
                          step={selectedActivitySport.distanceUnit === "m" ? "1" : "0.01"}
                          value={activityDistance}
                          onChange={(event) => setActivityDistance(event.target.value)}
                          placeholder="—"
                          disabled={submitting}
                        />
                        <em>{activityDistanceUnit}</em>
                      </span>
                    </label>
                  ) : null}
                  <label className="calendar-field">
                    <span>Calories</span>
                    <span className="calendar-unit-control">
                      <input
                        type="number"
                        min="0"
                        value={activityCalories}
                        onChange={(event) => setActivityCalories(event.target.value)}
                        placeholder="—"
                        disabled={submitting}
                      />
                      <em>kcal</em>
                    </span>
                  </label>
                  <label className="calendar-field">
                    <span>Average heart rate</span>
                    <span className="calendar-unit-control">
                      <input
                        type="number"
                        min="0"
                        value={activityAvgHr}
                        onChange={(event) => setActivityAvgHr(event.target.value)}
                        placeholder="—"
                        disabled={submitting}
                      />
                      <em>bpm</em>
                    </span>
                  </label>
                </div>
              </section>

              <footer className="calendar-modal-footer calendar-activity-footer">
                <p className="calendar-activity-hint">
                  {activityValid
                    ? "Goes straight to your COROS account."
                    : "Add a duration to log this activity."}
                </p>
                <button
                  type="button"
                  className="primary-button"
                  disabled={!activityValid || submitting}
                  onClick={() => void submitActivity()}
                >
                  {submitting ? "Adding…" : "Add to COROS"}
                </button>
              </footer>
            </div>
          ) : null}
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
}
