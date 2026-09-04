import {
  Activity,
  Check,
  Gauge,
  Loader2,
  LockKeyhole,
  Pencil,
  RefreshCw,
  ShieldCheck,
  User,
  X
} from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import type {
  CorosProfile,
  CorosProfilePatch,
  CorosProfileZone,
  CorosProfileZoneFamily,
  TrainingHubDashboard,
  TrainingHubStatus
} from "../../electron/types";
import type { CorosLinkApi } from "../coroslink-api";
import { FitnessScoresPanel } from "../training/components/FitnessScoresPanel";
import { PersonalRecordsPanel } from "../training/components/PersonalRecordsPanel";
import { RacePredictorCards } from "../training/components/RacePredictorCards";
import { formatPaceSecondsPerKm } from "../training/formatters";
import { useUnitSystem } from "../units/UnitSystemProvider";
import "./profile.css";

interface ProfileViewProps {
  api: CorosLinkApi;
  status: TrainingHubStatus | null;
  onOpenOverview: () => void;
  onMessage: (message: string) => void;
  onError: (message: string) => void;
}

// The editable half of the profile, held as form strings while the user types.
interface ProfileDraft {
  nickname: string;
  /** ISO `YYYY-MM-DD`, what `<input type="date">` speaks. */
  birthday: string;
  sex: string;
  statureCm: string;
  weightKg: string;
  maxHr: string;
  restingHr: string;
  unit: string;
  temperatureUnit: string;
  hrZoneType: string;
}

// COROS `hrZoneType`, labelled as its own web client labels the picker.
const HR_ZONE_MODELS: ReadonlyArray<{
  value: number;
  label: string;
  family: CorosProfileZoneFamily;
}> = [
  { value: 1, label: "Max heart rate", family: "maxHr" },
  { value: 2, label: "Heart rate reserve", family: "restingHr" },
  { value: 3, label: "Lactate threshold", family: "lthr" }
];

const ZONE_TABS: ReadonlyArray<{
  family: CorosProfileZoneFamily;
  label: string;
}> = [
  { family: "maxHr", label: "Max HR" },
  { family: "restingHr", label: "HR reserve" },
  { family: "lthr", label: "LTHR" },
  { family: "thresholdPace", label: "Pace" },
  { family: "cyclePower", label: "Power" }
];

/** Clock time of the cached read, so a stale screen is visibly stale. */
function formatCachedAt(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? ""
    : parsed.toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit"
      });
}

function hrZoneModel(value?: number) {
  return HR_ZONE_MODELS.find((model) => model.value === value);
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** COROS packs birthdays as YYYYMMDD; `<input type="date">` wants YYYY-MM-DD. */
function birthdayToInput(value?: number): string {
  if (!value || !Number.isFinite(value)) {
    return "";
  }

  const packed = String(Math.round(value)).padStart(8, "0");
  return `${packed.slice(0, 4)}-${packed.slice(4, 6)}-${packed.slice(6, 8)}`;
}

function inputToBirthday(value: string): number | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  return match ? Number(`${match[1]}${match[2]}${match[3]}`) : undefined;
}

function formatBirthday(value?: number): string {
  const iso = birthdayToInput(value);
  if (!iso) {
    return "—";
  }

  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC"
  });
}

function ageFromBirthday(value?: number): number | undefined {
  const iso = birthdayToInput(value);
  if (!iso) {
    return undefined;
  }

  const born = new Date(`${iso}T00:00:00Z`);
  const now = new Date();
  let age = now.getUTCFullYear() - born.getUTCFullYear();
  const monthDelta = now.getUTCMonth() - born.getUTCMonth();
  if (monthDelta < 0 || (monthDelta === 0 && now.getUTCDate() < born.getUTCDate())) {
    age -= 1;
  }

  return age >= 0 && age < 130 ? age : undefined;
}

function draftFromProfile(profile: CorosProfile): ProfileDraft {
  const text = (value?: number) =>
    value === undefined ? "" : String(value);

  return {
    nickname: profile.nickname ?? "",
    birthday: birthdayToInput(profile.birthday),
    sex: text(profile.sex),
    statureCm: text(profile.statureCm),
    weightKg: text(profile.weightKg),
    maxHr: text(profile.thresholds.maxHr),
    restingHr: text(profile.thresholds.restingHr),
    unit: text(profile.unit),
    temperatureUnit: text(profile.temperatureUnit),
    hrZoneType: text(profile.hrZoneType)
  };
}

/**
 * Only what the user actually changed goes to COROS: the endpoint merges the
 * fields it receives, so an untouched field is best left out entirely.
 */
function patchFromDraft(
  draft: ProfileDraft,
  profile: CorosProfile
): CorosProfilePatch {
  const patch: CorosProfilePatch = {};
  const baseline = draftFromProfile(profile);
  const changed = (key: keyof ProfileDraft) =>
    draft[key].trim() !== baseline[key].trim();
  const numeric = (value: string): number | undefined => {
    const parsed = Number(value.trim());
    return value.trim() && Number.isFinite(parsed) ? parsed : undefined;
  };

  if (changed("nickname")) {
    patch.nickname = draft.nickname.trim();
  }
  if (changed("birthday")) {
    const birthday = inputToBirthday(draft.birthday);
    if (birthday !== undefined) {
      patch.birthday = birthday;
    }
  }
  const assignNumber = (
    key: keyof ProfileDraft,
    apply: (value: number) => void
  ) => {
    if (!changed(key)) {
      return;
    }
    const value = numeric(draft[key]);
    if (value !== undefined) {
      apply(value);
    }
  };

  assignNumber("sex", (value) => (patch.sex = value));
  assignNumber("statureCm", (value) => (patch.statureCm = value));
  assignNumber("weightKg", (value) => (patch.weightKg = value));
  assignNumber("maxHr", (value) => (patch.maxHr = value));
  assignNumber("restingHr", (value) => (patch.restingHr = value));
  assignNumber("unit", (value) => (patch.unit = value));
  assignNumber("temperatureUnit", (value) => (patch.temperatureUnit = value));
  assignNumber("hrZoneType", (value) => (patch.hrZoneType = value));

  return patch;
}

function zoneValue(
  zone: CorosProfileZone,
  family: CorosProfileZoneFamily,
  unitSystem: ReturnType<typeof useUnitSystem>["unitSystem"]
): string {
  if (family === "thresholdPace") {
    return zone.paceSecondsPerKm
      ? formatPaceSecondsPerKm(zone.paceSecondsPerKm, unitSystem)
      : "—";
  }
  if (family === "cyclePower") {
    return zone.watts ? `${zone.watts} W` : "—";
  }
  return zone.bpm ? `${zone.bpm} bpm` : "—";
}

export function ProfileView({
  api,
  status,
  onOpenOverview,
  onMessage,
  onError
}: ProfileViewProps) {
  const { unitSystem } = useUnitSystem();
  const [profile, setProfile] = useState<CorosProfile | null>(null);
  // The fitness scores and race predictor read the same dashboard Overview uses.
  const [dashboard, setDashboard] = useState<TrainingHubDashboard | null>(null);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [draft, setDraft] = useState<ProfileDraft | null>(null);
  const [busy, setBusy] = useState<"load" | "save" | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [zoneTab, setZoneTab] = useState<CorosProfileZoneFamily | null>(null);
  const [zonesOpen, setZonesOpen] = useState(false);

  const connected = Boolean(status?.authenticated);
  const editing = draft !== null;

  useEffect(() => {
    if (!connected) {
      setProfile(null);
      return;
    }

    let cancelled = false;
    setBusy("load");
    setLoadError(null);
    // Served from the main process's hour-long cache, so reopening the screen
    // costs no COROS requests at all.
    void api
      .getCorosProfileSnapshot()
      .then((snapshot) => {
        if (cancelled) return;
        setProfile(snapshot.profile);
        setDashboard(snapshot.dashboard);
        setCachedAt(snapshot.cachedAt);
      })
      .catch((caught) => {
        if (!cancelled) setLoadError(messageFrom(caught));
      })
      .finally(() => {
        if (!cancelled) setBusy(null);
      });

    return () => {
      cancelled = true;
    };
  }, [api, connected]);

  useEffect(() => {
    if (!zonesOpen) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setZonesOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [zonesOpen]);

  const activeModel = hrZoneModel(profile?.hrZoneType);
  const zoneTabs = useMemo(
    () =>
      profile
        ? ZONE_TABS.filter(
            (tab) => profile.thresholds.zones[tab.family].length > 0
          )
        : [],
    [profile]
  );
  // The families do not all hold the same number of zones (6 for the heart-rate
  // ones, 7 for pace and power). Every tab renders the tallest count, padding
  // with blank rows, so switching tabs never resizes the dialog.
  const zoneRowCount = useMemo(
    () =>
      zoneTabs.reduce(
        (most, tab) =>
          Math.max(most, profile?.thresholds.zones[tab.family].length ?? 0),
        0
      ),
    [profile, zoneTabs]
  );
  // Until the user picks a tab, show the zones their HR model actually uses.
  const activeZoneTab = zoneTab ?? activeModel?.family ?? "maxHr";
  const zones = useMemo(
    () => (profile ? profile.thresholds.zones[activeZoneTab] : []),
    [profile, activeZoneTab]
  );

  async function handleRefresh() {
    setBusy("load");
    setLoadError(null);
    try {
      // The explicit action is the one place that goes past the cache.
      const snapshot = await api.getCorosProfileSnapshot({ refresh: true });
      setProfile(snapshot.profile);
      setDashboard(snapshot.dashboard);
      setCachedAt(snapshot.cachedAt);
    } catch (caught) {
      setLoadError(messageFrom(caught));
    } finally {
      setBusy(null);
    }
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile || !draft) {
      return;
    }

    const patch = patchFromDraft(draft, profile);
    if (Object.keys(patch).length === 0) {
      setDraft(null);
      return;
    }

    setBusy("save");
    try {
      const updated = await api.updateCorosProfile(patch);
      setProfile(updated);
      setCachedAt(new Date().toISOString());
      setDraft(null);
      onMessage("COROS profile updated.");
    } catch (caught) {
      onError(messageFrom(caught));
    } finally {
      setBusy(null);
    }
  }

  function updateDraft(key: keyof ProfileDraft, value: string) {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  }

  const age = ageFromBirthday(profile?.birthday);
  const weightRange = profile?.thresholds.ranges.weightKg;
  const maxHrRange = profile?.thresholds.ranges.maxHr;
  const restingHrRange = profile?.thresholds.ranges.restingHr;

  return (
    <div className="profile-view">
      <header className="profile-header">
        <div>
          <p className="eyebrow">COROS account</p>
          <h2>Personal</h2>
          <p>
            The identity, body metrics and training thresholds COROS holds for
            your account — and the zones it derives from them.
          </p>
        </div>
        {connected ? (
          <div className="profile-header-actions">
            {cachedAt && formatCachedAt(cachedAt) ? (
              <span className="profile-cached-at">
                Updated {formatCachedAt(cachedAt)}
              </span>
            ) : null}
            <button
              type="button"
              className="secondary-button"
              onClick={() => void handleRefresh()}
              disabled={busy !== null}
            >
              {busy === "load" ? (
                <Loader2 className="spin" size={16} aria-hidden="true" />
              ) : (
                <RefreshCw size={16} aria-hidden="true" />
              )}
              Refresh
            </button>
          </div>
        ) : null}
      </header>

      {!connected ? (
        <section className="panel profile-connect">
          <LockKeyhole size={24} aria-hidden="true" />
          <div>
            <h3>Connect COROS first</h3>
            <p>
              Your profile is read from the Training Hub session, so sign in
              before this screen has anything to show.
            </p>
          </div>
          <button type="button" className="primary-button" onClick={onOpenOverview}>
            Open Overview
          </button>
        </section>
      ) : loadError ? (
        <section className="panel profile-connect" role="alert">
          <X size={24} aria-hidden="true" />
          <div>
            <h3>Could not load your profile</h3>
            <p>{loadError}</p>
          </div>
          <button
            type="button"
            className="primary-button"
            onClick={() => void handleRefresh()}
            disabled={busy !== null}
          >
            Try again
          </button>
        </section>
      ) : !profile ? (
        <section className="panel profile-loading" aria-busy="true">
          <Loader2 className="spin" size={24} aria-hidden="true" />
          <p>Reading your COROS profile…</p>
        </section>
      ) : (
        <>
          <section className="panel profile-identity">
            {profile.avatarUrl ? (
              <img
                className="profile-avatar"
                src={profile.avatarUrl}
                alt=""
                referrerPolicy="no-referrer"
              />
            ) : (
              <span className="profile-avatar profile-avatar-empty" aria-hidden="true">
                <User size={30} />
              </span>
            )}
            <div className="profile-identity-copy">
              <h3>{profile.nickname ?? "COROS athlete"}</h3>
              <p>{profile.email ?? "No email on file"}</p>
              {profile.userId ? (
                <p className="profile-account-id profile-mono">
                  ID {profile.userId}
                </p>
              ) : null}
              <div className="profile-badges">
                {profile.countryCode ? (
                  <span className="profile-badge">{profile.countryCode}</span>
                ) : null}
                {profile.language ? (
                  <span className="profile-badge">{profile.language}</span>
                ) : null}
                {profile.twoFactorRequired ? (
                  <span className="profile-badge is-strong">
                    <ShieldCheck size={13} aria-hidden="true" /> 2FA on
                  </span>
                ) : null}
                {profile.activityCount !== undefined ? (
                  <span className="profile-badge">
                    <Activity size={13} aria-hidden="true" />{" "}
                    {profile.activityCount} activities
                  </span>
                ) : null}
              </div>
            </div>
            {!editing ? (
              <button
                type="button"
                className="secondary-button"
                onClick={() => setDraft(draftFromProfile(profile))}
                disabled={busy !== null}
              >
                <Pencil size={16} aria-hidden="true" />
                Edit
              </button>
            ) : null}
          </section>

          <form className="profile-grid" onSubmit={(event) => void handleSave(event)}>
            <section className="panel profile-card">
              <div className="profile-card-heading">
                <p className="eyebrow">Body</p>
                <h3>Metrics</h3>
              </div>
              {editing && draft ? (
                <div className="profile-fields">
                  <label className="field">
                    <span>Nickname</span>
                    <input
                      type="text"
                      maxLength={64}
                      value={draft.nickname}
                      onChange={(event) =>
                        updateDraft("nickname", event.target.value)
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Birthday</span>
                    <input
                      type="date"
                      value={draft.birthday}
                      onChange={(event) =>
                        updateDraft("birthday", event.target.value)
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Sex</span>
                    <select
                      value={draft.sex}
                      onChange={(event) => updateDraft("sex", event.target.value)}
                    >
                      <option value="0">Male</option>
                      <option value="1">Female</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>Height (cm)</span>
                    <input
                      type="number"
                      min={50}
                      max={280}
                      value={draft.statureCm}
                      onChange={(event) =>
                        updateDraft("statureCm", event.target.value)
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Weight (kg)</span>
                    <input
                      type="number"
                      step="0.1"
                      min={weightRange?.min ?? 10}
                      max={weightRange?.max ?? 300}
                      value={draft.weightKg}
                      onChange={(event) =>
                        updateDraft("weightKg", event.target.value)
                      }
                    />
                  </label>
                </div>
              ) : (
                <dl className="profile-list">
                  <div>
                    <dt>Birthday</dt>
                    <dd>
                      {formatBirthday(profile.birthday)}
                      {age !== undefined ? ` · ${age} yrs` : ""}
                    </dd>
                  </div>
                  <div>
                    <dt>Sex</dt>
                    <dd>
                      {profile.sex === 0
                        ? "Male"
                        : profile.sex === 1
                          ? "Female"
                          : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt>Height</dt>
                    <dd>
                      {profile.statureCm !== undefined
                        ? `${profile.statureCm} cm`
                        : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt>Weight</dt>
                    <dd>
                      {profile.weightKg !== undefined
                        ? `${profile.weightKg} kg`
                        : "—"}
                    </dd>
                  </div>
                </dl>
              )}
            </section>

            <section className="panel profile-card">
              <div className="profile-card-heading">
                <p className="eyebrow">Training</p>
                <h3>Thresholds</h3>
              </div>
              {editing && draft ? (
                <div className="profile-fields">
                  <label className="field">
                    <span>Zone model</span>
                    <select
                      value={draft.hrZoneType}
                      onChange={(event) =>
                        updateDraft("hrZoneType", event.target.value)
                      }
                    >
                      {HR_ZONE_MODELS.map((model) => (
                        <option key={model.value} value={model.value}>
                          {model.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Max heart rate (bpm)</span>
                    <input
                      type="number"
                      min={maxHrRange?.min ?? 120}
                      max={maxHrRange?.max ?? 240}
                      value={draft.maxHr}
                      onChange={(event) => updateDraft("maxHr", event.target.value)}
                    />
                  </label>
                  <label className="field">
                    <span>Resting heart rate (bpm)</span>
                    <input
                      type="number"
                      min={restingHrRange?.min ?? 30}
                      max={restingHrRange?.max ?? 120}
                      value={draft.restingHr}
                      onChange={(event) =>
                        updateDraft("restingHr", event.target.value)
                      }
                    />
                  </label>
                  <p className="profile-note">
                    Switching the zone model makes COROS rebuild your heart-rate
                    zones around that model's anchor. LTHR, threshold pace and
                    FTP stay COROS-calculated and are not editable here.
                  </p>
                </div>
              ) : (
                <dl className="profile-list">
                  <div>
                    <dt>Zone model</dt>
                    <dd>
                      {activeModel ? (
                        <button
                          type="button"
                          className="profile-zone-model-button"
                          onClick={() => setZonesOpen(true)}
                        >
                          {activeModel.label}
                          <Gauge size={14} aria-hidden="true" />
                        </button>
                      ) : (
                        "—"
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Max HR</dt>
                    <dd>
                      {profile.thresholds.maxHr
                        ? `${profile.thresholds.maxHr} bpm`
                        : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt>Resting HR</dt>
                    <dd>
                      {profile.thresholds.restingHr
                        ? `${profile.thresholds.restingHr} bpm`
                        : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt>LTHR</dt>
                    <dd>
                      {profile.thresholds.lthr
                        ? `${profile.thresholds.lthr} bpm`
                        : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt>Threshold pace</dt>
                    <dd>
                      {profile.thresholds.thresholdPaceSecondsPerKm
                        ? formatPaceSecondsPerKm(
                            profile.thresholds.thresholdPaceSecondsPerKm,
                            unitSystem
                          )
                        : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt>FTP</dt>
                    <dd>
                      {profile.thresholds.ftp ? `${profile.thresholds.ftp} W` : "—"}
                    </dd>
                  </div>
                </dl>
              )}
            </section>

            <section className="panel profile-card">
              <div className="profile-card-heading">
                <p className="eyebrow">Display</p>
                <h3>Units on your watch</h3>
              </div>
              {editing && draft ? (
                <div className="profile-fields">
                  <label className="field">
                    <span>Measurement</span>
                    <select
                      value={draft.unit}
                      onChange={(event) => updateDraft("unit", event.target.value)}
                    >
                      <option value="0">Metric</option>
                      <option value="1">Imperial</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>Temperature</span>
                    <select
                      value={draft.temperatureUnit}
                      onChange={(event) =>
                        updateDraft("temperatureUnit", event.target.value)
                      }
                    >
                      <option value="0">Celsius</option>
                      <option value="1">Fahrenheit</option>
                    </select>
                  </label>
                  <p className="profile-note">
                    These are COROS account settings — they change what your
                    watch and the COROS apps show, not this app's units.
                  </p>
                </div>
              ) : (
                <dl className="profile-list">
                  <div>
                    <dt>Measurement</dt>
                    <dd>{profile.unit === 1 ? "Imperial" : "Metric"}</dd>
                  </div>
                  <div>
                    <dt>Temperature</dt>
                    <dd>
                      {profile.temperatureUnit === 1 ? "Fahrenheit" : "Celsius"}
                    </dd>
                  </div>
                </dl>
              )}
            </section>

            {editing ? (
              <div className="profile-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setDraft(null)}
                  disabled={busy === "save"}
                >
                  <X size={16} aria-hidden="true" />
                  Cancel
                </button>
                <button
                  type="submit"
                  className="primary-button"
                  disabled={busy === "save"}
                >
                  {busy === "save" ? (
                    <Loader2 className="spin" size={16} aria-hidden="true" />
                  ) : (
                    <Check size={16} aria-hidden="true" />
                  )}
                  Save to COROS
                </button>
              </div>
            ) : null}
          </form>

          {zonesOpen ? (
            <div
              className="profile-dialog-backdrop"
              role="dialog"
              aria-modal="true"
              aria-labelledby="profile-zones-title"
              onClick={() => setZonesOpen(false)}
            >
              <section
                className="panel profile-dialog"
                onClick={(event) => event.stopPropagation()}
              >
                <header className="profile-dialog-header">
                  <div className="profile-card-heading">
                    <p className="eyebrow">Derived from your thresholds</p>
                    <h3 id="profile-zones-title">
                      <Gauge size={17} aria-hidden="true" /> Training zones
                    </h3>
                  </div>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="Close"
                    onClick={() => setZonesOpen(false)}
                  >
                    <X size={18} aria-hidden="true" />
                  </button>
                </header>
                <div className="profile-tabs" role="tablist" aria-label="Zone family">
                  {zoneTabs.map((tab) => (
                    <button
                      key={tab.family}
                      type="button"
                      role="tab"
                      aria-selected={activeZoneTab === tab.family}
                      className={activeZoneTab === tab.family ? "is-active" : ""}
                      onClick={() => setZoneTab(tab.family)}
                    >
                      {/* A dot, not the words "in use": the label has to stay
                          one line for the tab row to keep its height. */}
                      {activeModel?.family === tab.family ? (
                        <span className="profile-tab-dot" aria-hidden="true" />
                      ) : null}
                      {tab.label}
                    </button>
                  ))}
                </div>
                {zoneRowCount === 0 ? (
                  <p className="profile-note">
                    COROS has no zones for this metric yet.
                  </p>
                ) : (
                  <table className="profile-zone-table">
                    {/* Fixed columns, so a pace boundary and a bpm boundary do
                        not pull the table to different widths. */}
                    <colgroup>
                      <col className="profile-zone-col-name" />
                      <col className="profile-zone-col-share" />
                      <col className="profile-zone-col-value" />
                    </colgroup>
                    <thead>
                      <tr>
                        <th scope="col">Zone</th>
                        <th scope="col">Share</th>
                        <th scope="col">Boundary</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Array.from({ length: zoneRowCount }, (_, position) => {
                        const zone = zones[position];
                        return (
                          <tr key={`${activeZoneTab}-${position}`}>
                            <td>{zone ? `Z${position + 1}` : ""}</td>
                            <td>
                              {zone
                                ? zone.ratio !== undefined
                                  ? `${zone.ratio}%`
                                  : "—"
                                : ""}
                            </td>
                            <td>
                              {zone ? zoneValue(zone, activeZoneTab, unitSystem) : ""}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
                <p className="profile-note profile-dialog-footnote">
                  {activeModel
                    ? `Dotted tab is the model your zones are built from: ${activeModel.label}.`
                    : "COROS has not set a heart-rate zone model for this account."}
                </p>
              </section>
            </div>
          ) : null}

          <div className="profile-fitness-grid">
            <FitnessScoresPanel
              dashboard={dashboard}
              racePredictor={dashboard?.racePredictor ?? null}
            />
            <RacePredictorCards racePredictor={dashboard?.racePredictor ?? null} />
          </div>

          <PersonalRecordsPanel dashboard={dashboard} />
        </>
      )}
    </div>
  );
}
