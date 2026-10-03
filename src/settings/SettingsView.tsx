import {
  ArrowLeft,
  Bike,
  BrainCircuit,
  Bug,
  Check,
  ChevronRight,
  Coffee,
  Compass,
  Dumbbell,
  Ellipsis,
  ExternalLink,
  FolderOpen,
  Globe2,
  HardDrive,
  Link2,
  Loader2,
  Moon,
  Mountain,
  Palette,
  RefreshCw,
  Server,
  Sun,
  Watch,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import type {
  AppInfo,
  AppUpdateSnapshot,
  TrainingHubStatus,
} from "../../electron/types";
import { AppUpdateControl } from "../components/AppUpdateControls";
import { OptionChips, OptionGroup } from "../components/OptionGroup";
import { StartupViewMenu } from "../components/StartupViewMenu";
import { PRIMARY_NAV_ITEMS, type PrimaryView } from "../navigation/primaryNav";
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
import { formatBytes } from "./formatters";
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
  SPORT_COLOR_CATEGORIES,
  SPORT_COLOR_LABELS,
  applySportColors,
  readStoredSportColors,
  storeSportColors,
  type SportColorCategory,
} from "../training/sportColors";
import appLogo from "../../build/icon.png";
import { SyncPanel } from "./SyncPanel";
import { BackupPanel } from "./BackupPanel";

const BUY_ME_A_COFFEE_URL = "https://buymeacoffee.com/quochungse";

const WEBSITE_URL = "https://heraclesrecords.github.io";

interface McpSummary {
  total: number;
  connected: number;
  tools: number;
}

function mcpSummaryLine(summary: McpSummary | null): string {
  if (!summary) {
    return "Checking connections…";
  }
  if (summary.total === 0) {
    return "No servers added. Connect one to give the coach more tools.";
  }

  const servers = `${summary.connected} of ${summary.total} connected`;
  return summary.tools > 0
    ? `${servers} · ${summary.tools} ${summary.tools === 1 ? "tool" : "tools"} ready for the coach`
    : servers;
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

/** The sport screens as tiles, each wearing the icon it has on the sidebar. */
const SPORT_SCREEN_OPTIONS = SPORT_SCREENS.map((screen) => {
  const Icon = PRIMARY_NAV_ITEMS.find((item) => item.id === screen)?.icon;
  return {
    value: screen,
    label: getPrimaryViewLabel(screen),
    icon: Icon ? <Icon size={18} aria-hidden="true" /> : undefined,
  };
});

/**
 * A row in the Connections list that opens something: an icon, what it is, what
 * state it is in, and a chevron. Three copies of this markup sat inline, which
 * is how two of them ended up a size apart from the third.
 */
function SettingsNavRow({
  icon: Icon,
  title,
  detail,
  onClick
}: {
  icon: LucideIcon;
  title: string;
  detail: string;
  onClick: () => void;
}) {
  return (
    <button className="settings-nav-row" type="button" onClick={onClick}>
      <span className="settings-nav-row-icon" aria-hidden="true">
        <Icon size={20} strokeWidth={1.9} />
      </span>
      <span className="settings-nav-row-copy">
        <strong>{title}</strong>
        <span>{detail}</span>
      </span>
      <ChevronRight
        className="settings-row-chevron"
        size={20}
        strokeWidth={2}
        aria-hidden="true"
      />
    </button>
  );
}

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
  { id: "dark" as const, label: "Dark", icon: Moon },
  { id: "paper" as const, label: "Light", icon: Sun }
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
  const [loading, setLoading] = useState(false);
  const [openingLocationId, setOpeningLocationId] = useState<string | null>(
    null,
  );
  const [settingsPage, setSettingsPage] = useState<"main" | "storage">("main");
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

  const loadAppInfo = useCallback(async () => {
    setLoading(true);
    try {
      setAppInfo(await api.getAppInfo());
    } catch (caught) {
      onError(
        caught instanceof Error ? caught.message : "Could not load app info.",
      );
    } finally {
      setLoading(false);
    }
  }, [api, onError]);

  useEffect(() => {
    void loadAppInfo();
  }, [loadAppInfo]);

  async function handleOpenLocation(id: string) {
    setOpeningLocationId(id);
    try {
      await api.openAppStorageLocation(id);
    } catch (caught) {
      onError(
        caught instanceof Error
          ? caught.message
          : "Could not open that folder.",
      );
    } finally {
      setOpeningLocationId(null);
    }
  }

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
      ? { tone: "success", label: "Up to date" }
      : updateSnapshot.status === "downloaded"
        ? { tone: "accent", label: "Ready to install" }
        : null;

  const appVersion = appInfo?.version ?? updateSnapshot.currentVersion;

  if (settingsPage === "storage") {
    return (
      <section className="settings-view settings-subpage">
        <button
          className="settings-subpage-back"
          type="button"
          onClick={() => setSettingsPage("main")}
        >
          <ArrowLeft size={16} strokeWidth={2} aria-hidden="true" />
          Settings
        </button>

        <div className="panel settings-storage-detail-panel">
          <div className="section-heading settings-storage-detail-heading">
            <div>
              <p className="eyebrow">Storage</p>
              <h2>On this computer</h2>
              <p className="settings-subpage-description">
                Review storage use or open an app location on your computer.
              </p>
            </div>
            <button
              className="icon-button"
              type="button"
              title="Refresh storage sizes"
              aria-label="Refresh storage sizes"
              onClick={() => void loadAppInfo()}
              disabled={loading}
            >
              <RefreshCw
                size={16}
                aria-hidden="true"
                className={loading ? "spin" : ""}
              />
            </button>
          </div>

          {appInfo ? (
            <ul className="settings-storage-list">
              {appInfo.storageLocations.map((location) => (
                <li className="settings-storage-row" key={location.id}>
                  <div className="settings-storage-info">
                    <div className="settings-storage-title">
                      <strong>{location.label}</strong>
                      <span className="settings-storage-size">
                        {location.exists
                          ? location.sizeBytes !== null
                            ? formatBytes(location.sizeBytes)
                            : "Size unavailable"
                          : "Not created yet"}
                      </span>
                    </div>
                    <p>{location.description}</p>
                    <code className="settings-storage-path">
                      {location.path}
                    </code>
                  </div>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => void handleOpenLocation(location.id)}
                    disabled={
                      openingLocationId === location.id ||
                      (location.kind === "file" && !location.exists)
                    }
                  >
                    {openingLocationId === location.id ? (
                      <Loader2 size={15} aria-hidden="true" className="spin" />
                    ) : (
                      <FolderOpen size={15} aria-hidden="true" />
                    )}
                    Open in Folder
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="settings-storage-loading">
              <Loader2 size={16} aria-hidden="true" className="spin" />
              Loading storage locations…
            </p>
          )}
        </div>
      </section>
    );
  }

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
            <p>Unofficial COROS companion for training analytics.</p>
            <div className="settings-about-links">
              <a
                className="settings-about-link"
                href={WEBSITE_URL}
                target="_blank"
                rel="noreferrer"
              >
                <Globe2 size={15} aria-hidden="true" />
                <span>Website</span>
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
                <span>Report an issue</span>
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
              <span>Buy me a coffee</span>
            </span>
          </a>
        </div>

        {/* Where the app opens and which sport screens the rail lists: both
            are how the app is arranged, so they share one heading. The sport
            screens are not a facet of Activity colors below — a sport keeps
            its colour in Activities and the Calendar when its screen is off
            the rail, and Other has a colour but no screen. For the same
            reason the chips wear the accent, not the sports' hues: this is
            chrome, and the colours are spent on the row just below. */}
        <div className="settings-navigation">
          <div className="settings-section-head">
            <span className="settings-section-icon" aria-hidden="true">
              <Compass size={18} strokeWidth={1.9} />
            </span>
            <div>
              <h2>Navigation</h2>
              <p>Where the app opens, and which sport screens the sidebar lists.</p>
            </div>
          </div>
          <div className="settings-navigation-rows">
            <span className="settings-navigation-label">Opens on</span>
            <StartupViewMenu
              labeled
              value={startupView}
              onChange={onStartupViewChange}
              showDevelopmentItems={showDevelopmentTools}
              hiddenViews={hiddenSportScreens}
            />
            <span className="settings-navigation-label">Sport screens</span>
            <div>
              <OptionChips
                label="Sport screens"
                size="md"
                appearance="tiles"
                options={SPORT_SCREEN_OPTIONS}
                values={SPORT_SCREENS.filter(
                  (screen) => !hiddenSportScreens.includes(screen)
                )}
                onToggle={toggleSportScreen}
              />
              {/* Toned as a warning only once it has happened: Strength hidden
                  with Hevy connected takes Hevy's workouts off the screen. */}
              <p
                className={`settings-navigation-note${
                  hevyConnected && hiddenSportScreens.includes("strength")
                    ? " is-warning"
                    : ""
                }`}
              >
                {hevyConnected
                  ? "Every COROS session stays in Activities. Hevy workouts are only on Strength."
                  : "Every session stays in Activities."}
              </p>
            </div>
          </div>
        </div>

        {/* Appearance lives inside the About card rather than a card of its
            own. The mode switch sits on its own row under the heading;
            the five palettes sit under it as swatches, with the selected one
            named beside them. The palettes were five 220px cards carrying a
            sentence apiece — "Night-run blue, easy on the eyes after dark" — which is
            read once and never again, and which cost the section four hundred
            pixels for a choice made by looking at the colour. The sentence is
            not lost: the active one is shown under the row, and each swatch
            carries its own as a title. */}
        <div className="settings-appearance">
          <div className="settings-section-head">
            <span className="settings-section-icon" aria-hidden="true">
              <Palette size={18} strokeWidth={1.9} />
            </span>
            <div>
              <h2>Appearance</h2>
              <p>Colour mode, accent palette and the colours sports wear.</p>
            </div>
          </div>
          {/* The swap animates out of the point that was pressed, so the chip
              that produced the change comes back with it. */}
          <OptionGroup
            label="Color mode"
            size="md"
            value={theme}
            options={THEME_MODES.map((mode) => ({
              value: mode.id,
              label: mode.label,
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

          <div className="settings-palette-row">
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
            {/* The one sentence still worth showing, and it belongs to whichever
                swatch is selected — so the row stays readable without five
                copies of it. */}
            <p className="settings-palette-caption">
              <strong>{ACCENT_PALETTE_DETAILS[accent].label}</strong>
              <span>{ACCENT_PALETTE_DETAILS[accent].description}</span>
            </p>
          </div>

          {/* A secondary control, and sized like one. Five full rows with an
              icon tile, a sentence of description and a 164px picker apiece ran
              to roughly four hundred pixels for a preference most people set
              once; the chips carry the same two facts — which sport, which
              colour — in a fifth of the height. The per-sport descriptions went
              with them: the label already names the sport, and the sentence
              under it only listed examples of the thing it had just named. */}
          <div className="settings-sport-subheading">
            <div className="settings-sport-subheading-copy">
              <strong>Activity colors</strong>
              <span>
                Used by the training load heatmap and the calendar. A day with one
                sport is solid; several sports split into a wheel.
              </span>
            </div>
            <button
              className="settings-sport-reset"
              type="button"
              onClick={resetSportColors}
            >
              <RefreshCw size={13} strokeWidth={2} aria-hidden="true" />
              Reset
            </button>
          </div>
          <ul className="settings-sport-chips">
            {SPORT_COLOR_CATEGORIES.map((cat) => {
              const colorStyle = {
                "--sport-color": sportColors[cat],
              } as CSSProperties;

              const SportIcon = SPORT_COLOR_ICONS[cat];

              return (
                <li key={cat} style={colorStyle}>
                  <label className="settings-sport-chip">
                    <input
                      type="color"
                      className="settings-sport-input"
                      value={sportColors[cat]}
                      onChange={(event) =>
                        updateSportColor(cat, event.target.value)
                      }
                      aria-label={`${SPORT_COLOR_LABELS[cat]} color`}
                    />
                    <span className="settings-sport-swatch" aria-hidden="true">
                      <SportIcon size={14} strokeWidth={2.2} />
                    </span>
                    <span className="settings-sport-chip-label">
                      {SPORT_COLOR_LABELS[cat]}
                    </span>
                    <span className="settings-sport-hex">
                      {sportColors[cat].toUpperCase()}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      <div className="panel settings-connections-panel">
        <div className="settings-section-head">
          <span className="settings-section-icon" aria-hidden="true">
            <Link2 size={18} strokeWidth={1.9} />
          </span>
          <div>
            <h2>Connections</h2>
            <p>Accounts and services Heracles Records talks to on your behalf.</p>
          </div>
        </div>

        <div className="settings-connections-list">
          {trainingStatus?.authenticated ? (
            <CorosConnectionRow
              status={trainingStatus}
              busy={trainingBusy}
              onRefresh={onTrainingRefresh}
              onLogout={onTrainingLogout}
            />
          ) : (
            <SettingsNavRow
              icon={Watch}
              title="COROS account"
              detail={
                trainingStatus?.rememberCredentials && trainingStatus?.email
                  ? `Not connected. Sign in as ${trainingStatus.email} to sync activities and workouts.`
                  : "Not connected. Sign in to sync activities and workouts."
              }
              onClick={onTrainingSignIn}
            />
          )}

          <SettingsNavRow
            icon={Server}
            title="MCP Servers"
            detail={mcpSummaryLine(mcpSummary)}
            onClick={() => setMcpModalOpen(true)}
          />

          <SettingsNavRow
            icon={BrainCircuit}
            title="Coach Models"
            detail={coachModelsSummaryLine(coachModels)}
            onClick={() => setCoachModelsOpen(true)}
          />
        </div>
      </div>

      <SyncPanel api={api} />

      <BackupPanel api={api} />

      {/* The same compact row, with the whole head as the control: this panel
          is one link to a subpage, so an eyebrow above a 46px row spent a card
          saying what a row already said. */}
      <div className="panel settings-compact-panel">
        <button
          className="settings-compact-head is-link"
          type="button"
          onClick={() => setSettingsPage("storage")}
        >
          <span className="settings-compact-icon" aria-hidden="true">
            <HardDrive size={18} strokeWidth={1.9} />
          </span>
          <span className="settings-compact-copy">
            <strong>Storage on this computer</strong>
            <span>
              {appInfo
                ? `The database and the app's data folder — ${appInfo.storageLocations.length} locations.`
                : "The database and the app's data folder."}
            </span>
          </span>
          <ChevronRight
            className="settings-row-chevron"
            size={18}
            strokeWidth={2}
            aria-hidden="true"
          />
        </button>
      </div>

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
        Heracles Records {appVersion} · Made by quochungse
      </footer>
    </section>
  );
}
