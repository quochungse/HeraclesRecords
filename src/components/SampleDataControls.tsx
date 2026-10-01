import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import type { SampleDataState } from "../../electron/types";
import type { CorosLinkApi } from "../coroslink-api";

type MainSampleKind = keyof SampleDataState;
type SampleKind = MainSampleKind | "strength";

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
 * sample data" used to be, as one menu of checkboxes. Rides, hikes and trail
 * runs are added by the main process, so a change there reloads the window:
 * the activity list, the Calendar's range cache and the summaries all hold
 * what they read, and a reload is the one way to have every one of them read
 * again. Strength's is renderer state and switches in place.
 */
export function SampleDataControls({
  api,
  strengthSampleActive,
  onStrengthSampleChange,
  onError,
}: SampleDataControlsProps) {
  const [state, setState] = useState<SampleDataState | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!api || !import.meta.env.DEV) {
      return;
    }

    void api.getSampleData().then(setState);
  }, [api]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  if (!import.meta.env.DEV) {
    return null;
  }

  function isOn(kind: SampleKind): boolean {
    return kind === "strength" ? strengthSampleActive : Boolean(state?.[kind]);
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

  const activeCount = SAMPLE_OPTIONS.filter((option) => isOn(option.value)).length;
  const triggerLabel = activeCount > 0 ? `Sample · ${activeCount}` : "Sample";

  return (
    <div
      className="app-select app-select--pill app-select--watch-smoke"
      ref={containerRef}
    >
      <button
        className="app-select-trigger"
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Sample activities"
        onClick={() => setOpen((current) => !current)}
      >
        <span className="app-select-value">
          <span className="app-select-value-label">{triggerLabel}</span>
        </span>
        <ChevronDown
          className={open ? "app-select-icon is-open" : "app-select-icon"}
          size={17}
          strokeWidth={2.4}
          aria-hidden="true"
        />
      </button>

      {open ? (
        <div className="app-select-menu" role="menu" aria-label="Sample activities">
          <div className="app-select-menu-list">
            {SAMPLE_OPTIONS.map((option) => {
              const checked = isOn(option.value);
              return (
                <button
                  key={option.value}
                  className={`app-select-option${checked ? " is-selected" : ""}`}
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={checked}
                  title={option.title}
                  disabled={option.value !== "strength" && (!api || !state || busy)}
                  onClick={() => void handleToggle(option.value)}
                >
                  <span className="app-select-option-content">
                    <span className="app-select-option-label">{option.label}</span>
                  </span>
                  {checked ? (
                    <Check
                      className="app-select-option-check"
                      size={15}
                      strokeWidth={2.6}
                      aria-hidden="true"
                    />
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
