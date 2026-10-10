import {
  Bike,
  BrainCircuit,
  Bug,
  Check,
  Coffee,
  Compass,
  Dumbbell,
  Ellipsis,
  ExternalLink,
  Globe2,
  Link2,
  LogIn,
  Moon,
  Mountain,
  Palette,
  RefreshCw,
  Server,
  Sun,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import type {
  AppInfo,
  AppUpdateSnapshot,
  TrainingHubStatus,
} from "../../electron/types";
import { AppUpdateControl } from "../components/AppUpdateControls";
import { OptionChips, OptionGroup } from "../components/OptionGroup";
import {
  PRIMARY_NAV_ITEMS,
  visiblePrimaryNavItems,
  type PrimaryView
} from "../navigation/primaryNav";
import { getPrimaryViewLabel } from "../navigation/startupView";
import { SPORT_SCREENS, type SportScreen } from "../navigation/sportScreens";
import { RunnerIcon } from "../running/runnerIcon";
import {
  coachModelsSummaryLine,
  summarizeCoachModels,
  type CoachModelsSummary
} from "../chat/CoachModelsPanel";
import { summarizeMcpStatuses } from "../chat/McpServersPanel";
import type { HeraclesRecordsApi } from "../heraclesrecords-api";
import { CoachModelsModal } from "./CoachModelsModal";
import { McpServersModal } from "./McpServersModal";
import { ReportIssueDialog } from "./ReportIssueDialog";
import { useTheme } from "../theme/ThemeProvider";
import {
  ACCENT_PALETTES,
  ACCENT_PALETTE_DETAILS
} from "../theme/accentPalette";
import { CorosConnectionRow } from "../training/components/CorosConnectionRow";
import {
  DEFAULT_SPORT_COLORS,
  SPORT_COLOR_LABELS,
  applySportColors,
  readStoredSportColors,
  storeSportColors,
  type SportColorCategory,
} from "../training/sportColors";
// Drawn at 64px: the 128px cut is its 2× size.
import appLogo from "../../build/icons/128x128.png";
import { t, plural, setLocale } from "../i18n/core";
import { LanguageFlag } from "../i18n/LanguageFlag";
import { LOCALES, LOCALE_DETAILS, type Locale } from "../i18n/locales";
import { renderRich, useI18n } from "../i18n/useI18n";
import { SettingsPrefRow } from "./SettingsPrefRow";
import { SyncPanel } from "./SyncPanel";
import { BackupPanel } from "./BackupPanel";

const BUY_ME_A_COFFEE_URL = "https://buymeacoffee.com/quochungse";

const WEBSITE_URL = "https://heraclesrecords.com";

interface McpSummary {
  total: number;
  connected: number;
  tools: number;
}

/* The MCP and Coach Models rows state the count on one line and what it
   amounts to on the next, the part worth reading at a glance in bold — joined
   by a dot on one line, the second half wrapped wherever the column ended. */
const BOLD = { b: (chunk: ReactNode) => <strong>{chunk}</strong> };

function mcpSummaryDetail(summary: McpSummary | null): ReactNode {
  if (!summary) {
    return t("settings.mcp.checking");
  }
  if (summary.total === 0) {
    return t("settings.mcp.none");
  }

  const servers = t("settings.mcp.connected", {
    connected: summary.connected,
    total: summary.total,
  });
  if (summary.tools === 0) {
    return servers;
  }
  return (
    <>
      {servers}
      <span className="settings-pref-line">
        {renderRich(plural("settings.mcp.tools", summary.tools), BOLD)}
      </span>
    </>
  );
}

function coachModelsDetail(summary: CoachModelsSummary | null): ReactNode {
  if (!summary || summary.connected === 0) {
    return coachModelsSummaryLine(summary);
  }
  return (
    <>
      {t("settings.coachModels.providers", {
        connected: summary.connected,
        total: summary.total,
      })}
      <span className="settings-pref-line">
        {renderRich(
          t(
            summary.activeReady
              ? "settings.coachModels.inUse"
              : "settings.coachModels.notReady",
            { model: summary.activeLabel },
          ),
          BOLD,
        )}
      </span>
      {summary.claudeCodeUpdate ? (
        <span className="settings-pref-line settings-pref-warning">
          {renderRich(
            t("settings.coachModels.claudeUpdate", {
              latest: summary.claudeCodeUpdate.latest,
              installed: summary.claudeCodeUpdate.installed,
            }),
            { code: (chunk: ReactNode) => <code>{chunk}</code> },
          )}
        </span>
      ) : null}
    </>
  );
}

/** The mark each sport wears elsewhere in the app, so the colour is picked
    against the figure it will be seen on. The sentence of examples that used to
    sit beside each one is gone with the rows it needed: the label already names
    the sport. */
const SPORT_COLOR_ICONS: Record<SportColorCategory, LucideIcon> = {
  strength: Dumbbell,
  hiking: Mountain,
  run: RunnerIcon,
  bike: Bike,
  other: Ellipsis,
};

/** The colour tiles in the sport screens' order — Running, Cycling, Hiking,
    Strength — so each colour sits under its sport's screen in the card above,
    the two grids sharing their columns. Other, which has no screen, ends it. */
const SPORT_COLOR_ORDER: SportColorCategory[] = [
  "run",
  "bike",
  "hiking",
  "strength",
  "other",
];

/** The sport screens as tiles, each wearing the icon it has on the sidebar.
    Built while rendering, so the labels are in the language on screen. */
function sportScreenOptions() {
  return SPORT_SCREENS.map((screen) => {
    const Icon = PRIMARY_NAV_ITEMS.find((item) => item.id === screen)?.icon;
    return {
      value: screen,
      label: getPrimaryViewLabel(screen),
      icon: Icon ? <Icon size={18} aria-hidden="true" /> : undefined,
    };
  });
}

/** Each language in its own name and with its flag, so it can be found by
    someone who cannot read the language on screen. */
const LANGUAGE_OPTIONS = LOCALES.map((locale) => ({
  value: locale,
  label: LOCALE_DETAILS[locale].nativeName,
  title: locale === "en" ? undefined : LOCALE_DETAILS[locale].englishName,
  icon: <LanguageFlag locale={locale} />,
}));

interface SettingsViewProps {
  api: HeraclesRecordsApi;
  updateSnapshot: AppUpdateSnapshot;
  updateBusy: boolean;
  updateDownloading: boolean;
  onCheckForUpdates: () => void;
  onDownloadUpdate: () => void;
  onInstallUpdate: () => void;
  onUpdatePreferencesChange: (prefs: {
    autoCheck?: boolean;
    autoDownload?: boolean;
  }) => void;
  onError: (message: string) => void;
  /** Startup view lives here now; App owns the state so the toast it raises
      stays with the rest of the app-level messaging. */
  startupView: PrimaryView;
  onStartupViewChange: (view: PrimaryView) => void;
  /** Sport screens taken off the rail. App owns it, because the rail reads it. */
  hiddenSportScreens: SportScreen[];
  onHiddenSportScreensChange: (hidden: SportScreen[]) => void;
  showDevelopmentTools: boolean;
  /** COROS Training Hub session, shown as the connected-account card up top. */
  trainingStatus: TrainingHubStatus | null;
  trainingBusy: string | null;
  onTrainingRefresh: () => void;
  onTrainingLogout: () => void;
  /** Opens the COROS sign-in screen. App owns view routing, so the row here
      only asks for it. */
  onTrainingSignIn: () => void;
}

const THEME_MODES = [
  { id: "dark" as const, labelKey: "settings.colorMode.dark" as const, icon: Moon },
  { id: "paper" as const, labelKey: "settings.colorMode.light" as const, icon: Sun }
];

export function SettingsView({
  api,
  updateSnapshot,
  updateBusy,
  updateDownloading,
  onCheckForUpdates,
  onDownloadUpdate,
  onInstallUpdate,
  onUpdatePreferencesChange,
  onError,
  startupView,
  onStartupViewChange,
  hiddenSportScreens,
  onHiddenSportScreensChange,
  showDevelopmentTools,
  trainingStatus,
  trainingBusy,
  onTrainingRefresh,
  onTrainingLogout,
  onTrainingSignIn,
}: SettingsViewProps) {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [reportIssueOpen, setReportIssueOpen] = useState(false);
  const [mcpModalOpen, setMcpModalOpen] = useState(false);
  const [mcpSummary, setMcpSummary] = useState<McpSummary | null>(null);
  const [mcpRefreshVersion, setMcpRefreshVersion] = useState(0);
  const [coachModelsOpen, setCoachModelsOpen] = useState(false);
  const [coachModels, setCoachModels] = useState<CoachModelsSummary | null>(null);
  const [coachRefreshVersion, setCoachRefreshVersion] = useState(0);
  const { theme, setTheme, accent, setAccent } = useTheme();
  const [sportColors, setSportColors] = useState(() => readStoredSportColors());
  const [hevyConnected, setHevyConnected] = useState(false);
  const { locale } = useI18n();

  function updateSportColor(cat: SportColorCategory, value: string) {
    const next = { ...sportColors, [cat]: value };
    setSportColors(next);
    storeSportColors(next);
    applySportColors(next);
  }

  function resetSportColors() {
    const next = { ...DEFAULT_SPORT_COLORS };
    setSportColors(next);
    storeSportColors(next);
    applySportColors(next);
  }

  // Whether Hevy is connected, because a workout only Hevy knows — and the
  // connection itself — live on Strength alone, so "every session stays in
  // Activities" is not true of them. A local read, no request to Hevy.
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const status = await api.getHevyStatus();
        if (!cancelled) {
          setHevyConnected(status.connected);
        }
      } catch {
        // Unknown reads as not connected: the note keeps its general line.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [api]);

  // The row's own summary. It reads the same two calls the panel does rather
  // than the panel reporting upward, so the number is right before the dialog
  // has ever been opened.
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const [servers, statuses] = await Promise.all([
          api.listMcpServers(),
          api.getMcpStatuses()
        ]);
        if (!cancelled) {
          setMcpSummary(summarizeMcpStatuses(servers, statuses));
        }
      } catch {
        // A failed status read is not worth an error toast in Settings; the
        // row falls back to its "checking" line and the dialog reports the
        // real failure when it is opened.
        if (!cancelled) {
          setMcpSummary(null);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [api, mcpRefreshVersion]);

  // Same shape as the MCP row: the summary reads the settings and both account
  // statuses itself, so the row is right before the dialog is ever opened.
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const [chatSettings, authStatus, claudeStatus] = await Promise.all([
          api.getChatSettings(),
          api.getChatAuthStatus(),
          api.getClaudeCodeStatus()
        ]);
        if (!cancelled) {
          setCoachModels(
            summarizeCoachModels(chatSettings, authStatus, claudeStatus)
          );
        }
      } catch {
        if (!cancelled) {
          setCoachModels(null);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [api, coachRefreshVersion]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const info = await api.getAppInfo();
        if (!cancelled) {
          setAppInfo(info);
        }
      } catch (caught) {
        onError(
          caught instanceof Error ? caught.message : t("settings.about.loadFailed"),
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [api, onError]);

  function toggleSportScreen(screen: SportScreen) {
    onHiddenSportScreensChange(
      hiddenSportScreens.includes(screen)
        ? hiddenSportScreens.filter((hidden) => hidden !== screen)
        : [...hiddenSportScreens, screen]
    );
  }

  // Said beside the version, ahead of the Updates button. An available or
  // downloading update needs no words here: the button itself then reads
  // "Update 1.2.0" or "Downloading 40%".
  const updateStatus =
    updateSnapshot.status === "not-available"
      ? { tone: "success", label: t("settings.about.upToDate") }
      : updateSnapshot.status === "downloaded"
        ? { tone: "accent", label: t("settings.about.readyToInstall") }
        : null;

  const appVersion = appInfo?.version ?? updateSnapshot.currentVersion;

  // Every destination the rail offers, less the sport screens taken off it and
  // the ones that cannot be a start, each wearing its rail icon.
  const startupOptions = visiblePrimaryNavItems(
    showDevelopmentTools,
    hiddenSportScreens
  )
    .filter((item) => !item.excludeFromStartup)
    .map(({ id, label, icon: Icon }) => ({
      value: id,
      label,
      icon: <Icon size={15} aria-hidden="true" />
    }));

  return (
    <section className="settings-view">
      <div className="panel settings-about-panel">
        <div className="settings-about-header">
          <img
            className="settings-about-logo"
            src={appLogo}
            alt=""
            aria-hidden="true"
          />
          <div className="settings-about-copy">
            {/* The version, what the updater knows about it and the button that
                acts on it, in one line: they are one subject. */}
            <div className="settings-about-title">
              <h3>Heracles Records</h3>
              <span className="settings-about-version">{appVersion}</span>
              {updateStatus ? (
                <span
                  className="settings-about-status"
                  data-tone={updateStatus.tone}
                >
                  {updateStatus.label}
                </span>
              ) : null}
              <AppUpdateControl
                snapshot={updateSnapshot}
                busy={updateBusy}
                downloading={updateDownloading}
                onCheck={onCheckForUpdates}
                onDownload={onDownloadUpdate}
                onInstall={onInstallUpdate}
                onPreferencesChange={onUpdatePreferencesChange}
              />
            </div>
            <p>{t("settings.about.tagline")}</p>
            <div className="settings-about-links">
              <a
                className="settings-about-link"
                href={WEBSITE_URL}
                target="_blank"
                rel="noreferrer"
              >
                <Globe2 size={15} aria-hidden="true" />
                <span>{t("settings.about.website")}</span>
                <ExternalLink size={12} aria-hidden="true" />
              </a>
              {/* A dialog, not a link: it offers the error log to copy before
                  sending the athlete to GitHub. */}
              <button
                className="settings-about-link"
                type="button"
                onClick={() => setReportIssueOpen(true)}
              >
                <Bug size={15} aria-hidden="true" />
                <span>{t("settings.about.reportIssue")}</span>
              </button>
            </div>
          </div>
          {/* The header's far end, apart from the app's own controls. Drawn as
              the Color mode switch's chosen chip in a track of its own. */}
          <a
            className="settings-about-coffee"
            href={BUY_ME_A_COFFEE_URL}
            target="_blank"
            rel="noreferrer"
          >
            <span className="settings-about-coffee-chip">
              <Coffee size={15} aria-hidden="true" />
              <span>{t("settings.about.coffee")}</span>
            </span>
          </a>
        </div>
      </div>

      {/* Where the app opens and which sport screens the rail lists: both are
          how the app is arranged, so they share a card. The sport screens are
          not a facet of Activity colors in Appearance — a sport keeps its
          colour in Activities and the Calendar when its screen is off the
          rail, and Other has a colour but no screen. For the same reason the
          tiles wear the accent, not the sports' hues: this is chrome. */}
      <div className="panel settings-pref-panel">
        <div className="settings-section-head">
          <span className="settings-section-icon" aria-hidden="true">
            <Compass size={18} strokeWidth={1.9} />
          </span>
          <div>
            <h2>{t("settings.navigation.title")}</h2>
            <p>{t("settings.navigation.description")}</p>
          </div>
        </div>
        <div className="settings-pref-list">
          <SettingsPrefRow
            title={t("settings.opensOn.title")}
            detail={t("settings.opensOn.detail")}
          >
            <OptionGroup
              label={t("settings.opensOn.title")}
              mode="dropdown"
              size="md"
              value={startupView}
              options={startupOptions}
              onChange={onStartupViewChange}
            />
          </SettingsPrefRow>
          {/* The Hevy half is toned as a warning only once it has happened:
              Strength hidden with Hevy connected takes Hevy's workouts off the
              screen. */}
          <SettingsPrefRow
            title={t("settings.sportScreens.title")}
            detail={
              <>
                {t("settings.sportScreens.detail")}
                {hevyConnected ? (
                  <span
                    className={
                      hiddenSportScreens.includes("strength")
                        ? "settings-pref-warning"
                        : undefined
                    }
                  >
                    {" "}
                    {t("settings.sportScreens.hevy")}
                  </span>
                ) : null}
              </>
            }
            align="start"
          >
            <OptionChips
              label={t("settings.sportScreens.title")}
              size="md"
              appearance="tiles"
              options={sportScreenOptions()}
              values={SPORT_SCREENS.filter(
                (screen) => !hiddenSportScreens.includes(screen)
              )}
              onToggle={toggleSportScreen}
            />
          </SettingsPrefRow>
        </div>
      </div>

      {/* The palettes were five 220px cards carrying a sentence apiece —
          "Night-run blue, easy on the eyes after dark" — which is read once
          and never again, for a choice made by looking at the colour. The
          sentence is not lost: the active one is shown beside the swatches,
          and each swatch carries its own as a title. */}
      <div className="panel settings-pref-panel">
        <div className="settings-section-head">
          <span className="settings-section-icon" aria-hidden="true">
            <Palette size={18} strokeWidth={1.9} />
          </span>
          <div>
            <h2>{t("settings.appearance.title")}</h2>
            <p>{t("settings.appearance.description")}</p>
          </div>
        </div>
        <div className="settings-pref-list">
          {/* The switch waits for the language's own chunk, then every screen
              that subscribes redraws in it; nothing reloads. */}
          <SettingsPrefRow
            title={t("settings.language.title")}
            detail={t("settings.language.detail")}
          >
            <OptionGroup
              label={t("settings.language.title")}
              mode="dropdown"
              size="md"
              value={locale}
              options={LANGUAGE_OPTIONS}
              onChange={(next: Locale) => {
                void setLocale(next).catch((caught: unknown) =>
                  onError(caught instanceof Error ? caught.message : String(caught)),
                );
              }}
            />
          </SettingsPrefRow>

          <SettingsPrefRow
            title={t("settings.colorMode.title")}
            detail={t("settings.colorMode.detail")}
          >
            {/* The swap animates out of the point that was pressed, so the
                chip that produced the change comes back with it. */}
            <OptionGroup
              label={t("settings.colorMode.title")}
              size="md"
              value={theme}
              options={THEME_MODES.map((mode) => ({
                value: mode.id,
                label: t(mode.labelKey),
                icon: <mode.icon size={15} aria-hidden="true" />
              }))}
              onChange={(next, from) => {
                const rect = from?.getBoundingClientRect();
                setTheme(
                  next,
                  rect
                    ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
                    : undefined
                );
              }}
            />
          </SettingsPrefRow>

          <SettingsPrefRow
            title={t("settings.accent.title")}
            detail={t("settings.accent.detail")}
          >
            <div className="settings-palette-row">
              {/* The one sentence still worth showing, and it belongs to
                  whichever swatch is selected — on a line of its own above
                  them, so the row of swatches keeps its width as it changes. */}
              <p className="settings-palette-caption">
                <strong>{ACCENT_PALETTE_DETAILS[accent].label}</strong>
                <span>{ACCENT_PALETTE_DETAILS[accent].description}</span>
              </p>
              <ul className="settings-palette-swatches">
                {ACCENT_PALETTES.map((palette) => {
                  const detail = ACCENT_PALETTE_DETAILS[palette];
                  const active = accent === palette;
                  const swatchStyle = {
                    "--swatch-from": detail.swatch[0],
                    "--swatch-to": detail.swatch[1]
                  } as CSSProperties;

                  return (
                    <li key={palette}>
                      <button
                        className={`settings-palette-option${active ? " is-active" : ""}`}
                        type="button"
                        aria-pressed={active}
                        title={`${detail.label} — ${detail.description}`}
                        aria-label={detail.label}
                        onClick={(event) => {
                          const rect = event.currentTarget.getBoundingClientRect();
                          setAccent(palette, {
                            x: rect.left + rect.width / 2,
                            y: rect.top + rect.height / 2
                          });
                        }}
                      >
                        <span
                          className="settings-theme-swatch"
                          style={swatchStyle}
                          aria-hidden="true"
                        />
                        {active ? (
                          <Check size={15} strokeWidth={3} aria-hidden="true" />
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          </SettingsPrefRow>

          {/* A chip carries the two facts — which sport, which colour — in a
              fifth of the height that five rows with a picker apiece took. */}
          <SettingsPrefRow
            title={t("settings.activityColors.title")}
            detail={t("settings.activityColors.detail")}
            align="start"
            action={
              <button
                className="settings-sport-reset"
                type="button"
                onClick={resetSportColors}
              >
                <RefreshCw size={13} strokeWidth={2} aria-hidden="true" />
                {t("common.reset")}
              </button>
            }
          >
            <ul className="settings-sport-tiles">
              {SPORT_COLOR_ORDER.map((cat) => {
                const colorStyle = {
                  "--sport-color": sportColors[cat],
                } as CSSProperties;

                const SportIcon = SPORT_COLOR_ICONS[cat];

                return (
                  <li key={cat} style={colorStyle}>
                    <label className="settings-sport-tile">
                      <input
                        type="color"
                        className="settings-sport-input"
                        value={sportColors[cat]}
                        onChange={(event) =>
                          updateSportColor(cat, event.target.value)
                        }
                        aria-label={t("settings.activityColors.colorFor", {
                          sport: SPORT_COLOR_LABELS[cat],
                        })}
                      />
                      <span className="settings-sport-swatch" aria-hidden="true">
                        <SportIcon size={14} strokeWidth={2.2} />
                      </span>
                      <span className="settings-sport-tile-copy">
                        <span className="settings-sport-tile-label">
                          {SPORT_COLOR_LABELS[cat]}
                        </span>
                        <span className="settings-sport-hex">
                          {sportColors[cat].toUpperCase()}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </SettingsPrefRow>
        </div>
      </div>

      <div className="panel settings-pref-panel">
        <div className="settings-section-head">
          <span className="settings-section-icon" aria-hidden="true">
            <Link2 size={18} strokeWidth={1.9} />
          </span>
          <div>
            <h2>{t("settings.connections.title")}</h2>
            <p>{t("settings.connections.description")}</p>
          </div>
        </div>

        <div className="settings-pref-list">
          {trainingStatus?.authenticated ? (
            <CorosConnectionRow
              status={trainingStatus}
              busy={trainingBusy}
              onRefresh={onTrainingRefresh}
              onLogout={onTrainingLogout}
            />
          ) : (
            <SettingsPrefRow
              title={t("settings.coros.title")}
              detail={
                trainingStatus?.rememberCredentials && trainingStatus?.email
                  ? t("settings.coros.notConnectedAs", { email: trainingStatus.email })
                  : t("settings.coros.notConnected")
              }
            >
              <button
                className="settings-row-button is-primary"
                type="button"
                onClick={onTrainingSignIn}
              >
                <LogIn size={15} aria-hidden="true" />
                {t("common.signIn")}
              </button>
            </SettingsPrefRow>
          )}

          <SettingsPrefRow
            title={t("settings.mcp.title")}
            detail={mcpSummaryDetail(mcpSummary)}
            tone={mcpSummary && mcpSummary.connected > 0 ? "success" : undefined}
          >
            <button
              className="settings-row-button"
              type="button"
              onClick={() => setMcpModalOpen(true)}
            >
              <Server size={15} aria-hidden="true" />
              {t("common.manage")}
            </button>
          </SettingsPrefRow>

          <SettingsPrefRow
            title={t("settings.coachModels.title")}
            detail={coachModelsDetail(coachModels)}
            tone={
              !coachModels || coachModels.connected === 0
                ? undefined
                : coachModels.activeReady
                  ? "success"
                  : "warning"
            }
          >
            <button
              className="settings-row-button"
              type="button"
              onClick={() => setCoachModelsOpen(true)}
            >
              <BrainCircuit size={15} aria-hidden="true" />
              {t("common.manage")}
            </button>
          </SettingsPrefRow>
        </div>
      </div>

      <SyncPanel api={api} onCheckForUpdates={onCheckForUpdates} />

      <BackupPanel api={api} />

      <McpServersModal
        api={api}
        open={mcpModalOpen}
        refreshVersion={mcpRefreshVersion}
        onClose={() => setMcpModalOpen(false)}
        onChange={() => setMcpRefreshVersion((version) => version + 1)}
      />

      <ReportIssueDialog
        api={api}
        open={reportIssueOpen}
        onClose={() => setReportIssueOpen(false)}
      />

      <CoachModelsModal
        api={api}
        open={coachModelsOpen}
        onClose={() => setCoachModelsOpen(false)}
        onChange={() => setCoachRefreshVersion((version) => version + 1)}
      />

      <footer className="settings-footer">
        {t("settings.footer", { version: appVersion })}
      </footer>
    </section>
  );
}
