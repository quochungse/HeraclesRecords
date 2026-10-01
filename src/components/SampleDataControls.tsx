import { useEffect, useState } from "react";
import type { SampleDataState } from "../../electron/types";
import type { CorosLinkApi } from "../coroslink-api";
import { OptionChips, type OptionGroupOption } from "./OptionGroup";

type MainSampleKind = keyof SampleDataState;
type SampleKind = MainSampleKind | "strength";

const MAIN_SAMPLE_KINDS: readonly MainSampleKind[] = ["rides", "hikes", "trailRuns"];

const SAMPLE_OPTIONS: readonly { value: SampleKind; label: string; title: string }[] = [
  { value: "rides", label: "Rides", title: "Simulated rides (electron/sampleRides.ts)" },
  { value: "hikes", label: "Hikes", title: "Simulated hikes (electron/sampleHikes.ts)" },
  {
    value: "trailRuns",
    label: "Trail runs",
    title: "Simulated trail runs (electron/sampleTrailRuns.ts)",
  },
  {
    value: "strength",
    label: "Strength",
    title: "Generated strength history on the Strength screen",
  },
];

interface SampleDataControlsProps {
  api: CorosLinkApi | undefined;
  strengthSampleActive: boolean;
  onStrengthSampleChange: (active: boolean) => void;
  onError: (message: string) => void;
}

/**
 * The switches `npm run dev:sample-*` and the Strength screen's "Preview with
 * sample data" used to be. Rides, hikes and trail runs are added by the main
 * process, so a change there reloads the window: the activity list, the
 * Calendar's range cache and the summaries all hold what they read, and a
 * reload is the one way to have every one of them read again. Strength's is
 * renderer state and switches in place.
 */
export function SampleDataControls({
  api,
  strengthSampleActive,
  onStrengthSampleChange,
  onError,
}: SampleDataControlsProps) {
  const [state, setState] = useState<SampleDataState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!api || !import.meta.env.DEV) {
      return;
    }

    void api.getSampleData().then(setState);
  }, [api]);

  if (!import.meta.env.DEV) {
    return null;
  }

  async function handleToggle(kind: SampleKind) {
    if (kind === "strength") {
      onStrengthSampleChange(!strengthSampleActive);
      return;
    }
    if (!api || !state || busy) {
      return;
    }

    setBusy(true);
    try {
      await api.setSampleData(kind, !state[kind]);
      window.location.reload();
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : String(caught));
      setBusy(false);
    }
  }

  const options: OptionGroupOption<SampleKind>[] = SAMPLE_OPTIONS.map((option) => ({
    ...option,
    disabled: option.value !== "strength" && (!api || !state || busy),
  }));
  const values: SampleKind[] = [
    ...(state ? MAIN_SAMPLE_KINDS.filter((kind) => state[kind]) : []),
    ...(strengthSampleActive ? (["strength"] as const) : []),
  ];

  return (
    <OptionChips
      label="Sample activities"
      options={options}
      values={values}
      onToggle={(kind) => void handleToggle(kind)}
    />
  );
}
