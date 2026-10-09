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
import { OptionGroup } from "../components/OptionGroup";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import type {
  CorosProfile,
  CorosProfilePatch,
  CorosProfileZone,
  CorosProfileZoneFamily,
  TrainingHubDashboard,
  TrainingHubStatus
} from "../../electron/types";
import type { HeraclesRecordsApi } from "../heraclesrecords-api";
import { FitnessScoresPanel } from "../training/components/FitnessScoresPanel";
import { PersonalRecordsPanel } from "../training/components/PersonalRecordsPanel";
import { Vo2MaxWidget } from "../training/components/Vo2MaxWidget";
import { formatPaceSecondsPerKm } from "../training/formatters";
import {
  HR_ZONE_MODELS,
  hrZoneModelDefinition
} from "../training/heartRateZoneModel";
import type { TrainingHubSnapshot } from "../training/types";
import { useUnitSystem } from "../units/UnitSystemProvider";
import {
  centimetersToDisplayHeight,
  displayHeightToCentimeters,
  displayWeightToKilograms,
  formatWeightValue,
  heightUnit,
  kilogramsToDisplayWeight,
  weightUnit,
  type UnitSystem
} from "../units/units";
import { getIntlLocale, messageRecord, plural, t } from "../i18n/core";
import { useI18n } from "../i18n/useI18n";
import "./profile.css";

interface ProfileViewProps {
  api: HeraclesRecordsApi;
  status: TrainingHubStatus | null;
  /**
   * The snapshot Overview reads. VO2 max history lives in its day lists, which
   * the profile read does not carry.
   */
  snapshot: TrainingHubSnapshot | null;
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

const ZONE_TAB_LABELS = messageRecord<CorosProfileZoneFamily>({
  maxHr: "profile.zoneTab.maxHr",
  restingHr: "profile.zoneTab.reserve",
  lthr: "profile.zoneTab.lthr",
  thresholdPace: "profile.zoneTab.pace",
  cyclePower: "profile.zoneTab.power"
});

const ZONE_TABS: ReadonlyArray<{ family: CorosProfileZoneFamily }> = [
  { family: "maxHr" },
  { family: "restingHr" },
  { family: "lthr" },
  { family: "thresholdPace" },
  { family: "cyclePower" }
];

/** Clock time of the cached read, so a stale screen is visibly stale. */
function formatCachedAt(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? ""
    : parsed.toLocaleTimeString(getIntlLocale(), {
        hour: "2-digit",
        minute: "2-digit"
      });
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

  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(getIntlLocale(), {
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

/**
 * The two body fields are edited in the athlete's own unit and stored in
 * COROS's (centimetres and kilograms), so the draft carries the display value
 * and `patchFromDraft` converts it back. Both directions round to one decimal,
 * and `patchFromDraft` rebuilds this same baseline to decide what changed —
 * so a field nobody touched produces the identical string and no write, rather
 * than a hair of float drift COROS would store forever.
 */
function displayNumber(value: number | undefined, convert: (value: number) => number): string {
  if (value === undefined) {
    return "";
  }
  const converted = Math.round(convert(value) * 10) / 10;
  return String(converted);
}

/**
 * Metric and Imperial name a system, not a unit, and this is the one switch in
 * the app that decides what every figure in it is measured in — so the two
 * units an athlete actually reads ride on the chip itself rather than in a
 * tooltip. The fuller list stays as the tooltip, which is where the Settings
 * panel this replaced used to keep it.
 */
function measurementOptions() {
  return [
    {
      value: "0",
      label: t("profile.unit.metric"),
      title: t("profile.unit.metricTitle")
    },
    {
      value: "1",
      label: t("profile.unit.imperial"),
      title: t("profile.unit.imperialTitle")
    }
  ];
}

function measurementLabel(unit: number | undefined): string {
  const options = measurementOptions();
  return (
    options.find((option) => option.value === String(unit ?? 0))?.label ??
    options[0]!.label
  );
}

function draftFromProfile(
  profile: CorosProfile,
  unitSystem: UnitSystem
): ProfileDraft {
  const text = (value?: number) =>
    value === undefined ? "" : String(value);

  return {
    nickname: profile.nickname ?? "",
    birthday: birthdayToInput(profile.birthday),
    sex: text(profile.sex),
    statureCm: displayNumber(profile.statureCm, (value) =>
      centimetersToDisplayHeight(value, unitSystem)
    ),
    weightKg: displayNumber(profile.weightKg, (value) =>
      kilogramsToDisplayWeight(value, unitSystem)
    ),
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
  profile: CorosProfile,
  unitSystem: UnitSystem
): CorosProfilePatch {
  const patch: CorosProfilePatch = {};
  const baseline = draftFromProfile(profile, unitSystem);
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
  const round1 = (value: number) => Math.round(value * 10) / 10;
  assignNumber(
    "statureCm",
    (value) => (patch.statureCm = round1(displayHeightToCentimeters(value, unitSystem)))
  );
  assignNumber(
    "weightKg",
    (value) => (patch.weightKg = round1(displayWeightToKilograms(value, unitSystem)))
  );
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
  snapshot,
  onOpenOverview,
  onMessage,
  onError
}: ProfileViewProps) {
  useI18n();
  const { unitSystem, refreshUnitSystem } = useUnitSystem();
  const [profile, setProfile] = useState<CorosProfile | null>(null);
  // The fitness scores read the same dashboard Overview uses.
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

  const activeModel = hrZoneModelDefinition(profile?.hrZoneType);
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

    const patch = patchFromDraft(draft, profile, unitSystem);
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
      // Measurement is the app's only unit switch, so the screens behind this
      // one have to turn over with it. `refresh` is not optional here: the
      // profile the provider would otherwise read comes from the main process's
      // hour-long cache, which still holds the unit as it was a moment ago.
      if (patch.unit !== undefined) {
        await refreshUnitSystem({ refresh: true });
      }
      onMessage(t("profile.updated"));
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
          <p className="eyebrow">{t("profile.eyebrow")}</p>
          <h2>{t("nav.profile")}</h2>
          <p>{t("profile.subtitle")}</p>
        </div>
        {connected ? (
          <div className="profile-header-actions">
            {cachedAt && formatCachedAt(cachedAt) ? (
              <span className="profile-cached-at">
                {t("profile.updatedAt", { time: formatCachedAt(cachedAt) })}
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
              {t("common.refresh")}
            </button>
          </div>
        ) : null}
      </header>

      {!connected ? (
        <section className="panel profile-connect">
          <LockKeyhole size={24} aria-hidden="true" />
          <div>
            <h3>{t("common.connectFirst.title")}</h3>
            <p>{t("profile.connectBody")}</p>
          </div>
          <button type="button" className="primary-button" onClick={onOpenOverview}>
            {t("common.openOverview")}
          </button>
        </section>
      ) : loadError ? (
        <section className="panel profile-connect" role="alert">
          <X size={24} aria-hidden="true" />
          <div>
            <h3>{t("profile.loadFailed")}</h3>
            <p>{loadError}</p>
          </div>
          <button
            type="button"
            className="primary-button"
            onClick={() => void handleRefresh()}
            disabled={busy !== null}
          >
            {t("common.tryAgain")}
          </button>
        </section>
      ) : !profile ? (
        <section className="panel profile-loading" aria-busy="true">
          <Loader2 className="spin" size={24} aria-hidden="true" />
          <p>{t("profile.reading")}</p>
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
              <h3>{profile.nickname ?? t("profile.athlete")}</h3>
              <p>{profile.email ?? t("profile.noEmail")}</p>
              {profile.userId ? (
                <p className="profile-account-id profile-mono">
                  {t("profile.id", { id: profile.userId })}
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
                    <ShieldCheck size={13} aria-hidden="true" /> {t("profile.twoFactor")}
                  </span>
                ) : null}
                {profile.activityCount !== undefined ? (
                  <span className="profile-badge">
                    <Activity size={13} aria-hidden="true" />{" "}
                    {plural("profile.activities", profile.activityCount)}
                  </span>
                ) : null}
              </div>
            </div>
            {!editing ? (
              <button
                type="button"
                className="secondary-button"
                onClick={() => setDraft(draftFromProfile(profile, unitSystem))}
                disabled={busy !== null}
              >
                <Pencil size={16} aria-hidden="true" />
                {t("profile.edit")}
              </button>
            ) : null}
          </section>

          <form className="profile-grid" onSubmit={(event) => void handleSave(event)}>
            <section className="panel profile-card">
              <div className="profile-card-heading">
                <p className="eyebrow">{t("profile.body.eyebrow")}</p>
                <h3>{t("profile.body.title")}</h3>
              </div>
              {editing && draft ? (
                <div className="profile-fields">
                  <label className="field">
                    <span>{t("profile.nickname")}</span>
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
                    <span>{t("profile.birthday")}</span>
                    <input
                      type="date"
                      value={draft.birthday}
                      onChange={(event) =>
                        updateDraft("birthday", event.target.value)
                      }
                    />
                  </label>
                  <label className="field">
                    <span>{t("profile.sex")}</span>
                    <OptionGroup
                      label={t("profile.sex")}
                      size="md"
                      fill
                      value={draft.sex}
                      options={[
                        { value: "0", label: t("profile.male") },
                        { value: "1", label: t("profile.female") }
                      ]}
                      onChange={(next) => updateDraft("sex", next)}
                    />
                  </label>
                  <label className="field">
                    <span>{t("profile.heightIn", { unit: heightUnit(unitSystem) })}</span>
                    <input
                      type="number"
                      /* COROS stores height as whole centimetres, so 175.5
                         would be saved as 176 and read back changed. Inches
                         cannot be whole and stay representable — one inch is
                         2.54cm — so imperial keeps a decimal and settles on the
                         nearest centimetre the store can hold. */
                      step={unitSystem === "imperial" ? "0.1" : "1"}
                      /* Inward, both ends: the bound is checked in centimetres
                         after rounding, so an outward-rounded 19in offers a
                         value the save rejects as out of range. */
                      min={Math.ceil(centimetersToDisplayHeight(50, unitSystem))}
                      max={Math.floor(centimetersToDisplayHeight(280, unitSystem))}
                      value={draft.statureCm}
                      onChange={(event) =>
                        updateDraft("statureCm", event.target.value)
                      }
                    />
                  </label>
                  <label className="field">
                    <span>{t("profile.weightIn", { unit: weightUnit(unitSystem) })}</span>
                    <input
                      type="number"
                      step="0.1"
                      /* Inward, for the reason the height field gives. */
                      min={Math.ceil(
                        kilogramsToDisplayWeight(weightRange?.min ?? 10, unitSystem) * 10
                      ) / 10}
                      max={Math.floor(
                        kilogramsToDisplayWeight(weightRange?.max ?? 300, unitSystem) * 10
                      ) / 10}
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
                    <dt>{t("profile.birthday")}</dt>
                    <dd>
                      {formatBirthday(profile.birthday)}
                      {age !== undefined ? ` · ${plural("profile.age", age)}` : ""}
                    </dd>
                  </div>
                  <div>
                    <dt>{t("profile.sex")}</dt>
                    <dd>
                      {profile.sex === 0
                        ? t("profile.male")
                        : profile.sex === 1
                          ? t("profile.female")
                          : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt>{t("profile.height")}</dt>
                    <dd>
                      {profile.statureCm !== undefined
                        ? `${Math.round(
                            centimetersToDisplayHeight(profile.statureCm, unitSystem) * 10
                          ) / 10} ${heightUnit(unitSystem)}`
                        : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt>{t("profile.weight")}</dt>
                    <dd>
                      {profile.weightKg !== undefined
                        ? formatWeightValue(profile.weightKg, unitSystem, 1)
                        : "—"}
                    </dd>
                  </div>
                </dl>
              )}
            </section>

            <section className="panel profile-card">
              <div className="profile-card-heading">
                <p className="eyebrow">{t("profile.training.eyebrow")}</p>
                <h3>{t("profile.training.title")}</h3>
              </div>
              {editing && draft ? (
                <div className="profile-fields">
                  <label className="field">
                    <span>{t("profile.zoneModel")}</span>
                    <OptionGroup
                      label={t("profile.zoneModel")}
                      mode="dropdown"
                      size="md"
                      value={draft.hrZoneType}
                      options={HR_ZONE_MODELS.map((model) => ({
                        value: String(model.value),
                        label: model.label
                      }))}
                      onChange={(next) => updateDraft("hrZoneType", next)}
                    />
                  </label>
                  <label className="field">
                    <span>{t("profile.maxHrField")}</span>
                    <input
                      type="number"
                      min={maxHrRange?.min ?? 120}
                      max={maxHrRange?.max ?? 240}
                      value={draft.maxHr}
                      onChange={(event) => updateDraft("maxHr", event.target.value)}
                    />
                  </label>
                  <label className="field">
                    <span>{t("profile.restingHrField")}</span>
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
                    {t("profile.zoneModelNote")}
                  </p>
                </div>
              ) : (
                <dl className="profile-list">
                  <div>
                    <dt>{t("profile.zoneModel")}</dt>
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
                    <dt>{t("profile.maxHr")}</dt>
                    <dd>
                      {profile.thresholds.maxHr
                        ? `${profile.thresholds.maxHr} bpm`
                        : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt>{t("profile.restingHr")}</dt>
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
                    <dt>{t("profile.thresholdPace")}</dt>
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
                <p className="eyebrow">{t("profile.display.eyebrow")}</p>
                <h3>{t("profile.display.title")}</h3>
              </div>
              {editing && draft ? (
                <div className="profile-fields">
                  <label className="field">
                    <span>{t("profile.measurement")}</span>
                    <OptionGroup
                      label={t("profile.measurement")}
                      size="md"
                      fill
                      value={draft.unit}
                      options={measurementOptions()}
                      onChange={(next) => updateDraft("unit", next)}
                    />
                  </label>
                  <label className="field">
                    <span>{t("profile.temperature")}</span>
                    <OptionGroup
                      label={t("profile.temperature")}
                      size="md"
                      fill
                      value={draft.temperatureUnit}
                      options={[
                        { value: "0", label: t("profile.celsius") },
                        { value: "1", label: t("profile.fahrenheit") }
                      ]}
                      onChange={(next) => updateDraft("temperatureUnit", next)}
                    />
                  </label>
                  <p className="profile-note">
                    {t("profile.unitsNote")}
                  </p>
                </div>
              ) : (
                <dl className="profile-list">
                  <div>
                    <dt>{t("profile.measurement")}</dt>
                    <dd>{measurementLabel(profile.unit)}</dd>
                  </div>
                  <div>
                    <dt>{t("profile.temperature")}</dt>
                    <dd>
                      {profile.temperatureUnit === 1 ? t("profile.fahrenheit") : t("profile.celsius")}
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
                  {t("common.cancel")}
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
                  {t("profile.save")}
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
                    <p className="eyebrow">{t("profile.zones.eyebrow")}</p>
                    <h3 id="profile-zones-title">
                      <Gauge size={17} aria-hidden="true" /> {t("profile.zones.title")}
                    </h3>
                  </div>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={t("common.close")}
                    onClick={() => setZonesOpen(false)}
                  >
                    <X size={18} aria-hidden="true" />
                  </button>
                </header>
                {/* Folded: up to five families, and the one in use is the one
                    the athlete came to read. A dot, not the words "in use":
                    the label has to stay one line. */}
                <OptionGroup
                  label={t("profile.zones.family")}
                  mode="collapsible"
                  className="profile-tabs"
                  value={activeZoneTab}
                  options={zoneTabs.map((tab) => ({
                    value: tab.family,
                    label: ZONE_TAB_LABELS[tab.family],
                    ...(activeModel?.family === tab.family
                      ? {
                          icon: (
                            <span className="profile-tab-dot" aria-hidden="true" />
                          ),
                          title: t("profile.zones.inUse")
                        }
                      : {})
                  }))}
                  onChange={setZoneTab}
                />
                {zoneRowCount === 0 ? (
                  <p className="profile-note">
                    {t("profile.zones.none")}
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
                        <th scope="col">{t("profile.zones.zone")}</th>
                        <th scope="col">{t("profile.zones.share")}</th>
                        <th scope="col">{t("profile.zones.boundary")}</th>
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
                    ? t("profile.zones.dotted", { model: activeModel.label })
                    : t("profile.zones.noModel")}
                </p>
              </section>
            </div>
          ) : null}

          <div className="profile-fitness-grid">
            <FitnessScoresPanel
              dashboard={dashboard}
              racePredictor={dashboard?.racePredictor ?? null}
            />
            <Vo2MaxWidget snapshot={snapshot} />
          </div>

          <PersonalRecordsPanel dashboard={dashboard} />
        </>
      )}
    </div>
  );
}
