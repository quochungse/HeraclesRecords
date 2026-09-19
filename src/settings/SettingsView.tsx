import {
  ArrowLeft,
  Bike,
  BrainCircuit,
  Bug,
  Check,
  ChevronRight,
  Code2,
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
import { ResourcesMenu } from "../components/ResourcesMenu";
import { OptionGroup } from "../components/OptionGroup";
import { StartupViewMenu } from "../components/StartupViewMenu";
import type { PrimaryView } from "../navigation/primaryNav";
import { getPrimaryViewIcon } from "../navigation/startupView";
import { RunnerIcon } from "../running/runnerIcon";
import {
  coachModelsSummaryLine,
  summarizeCoachModels,
  type CoachModelsSummary
} from "../chat/CoachModelsPanel";
import { summarizeMcpStatuses } from "../chat/McpServersPanel";
import type { CorosLinkApi } from "../coroslink-api";
import { CoachModelsModal } from "./CoachModelsModal";
import { McpServersModal } from "./McpServersModal";
import { formatBytes } from "../media/libraryUtils";
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

const ABOUT_LINKS = [
  {
    label: "Website",
    href: "https://coros-link.vercel.app/",
    icon: Globe2,
  },
  {
    label: "Source on GitHub",
    href: "https://github.com/quochungse/HeraclesRecords",
    icon: Code2,
  },
  {
    label: "Report an issue",
    href: "https://github.com/quochungse/HeraclesRecords/issues",
    icon: Bug,
  },
];

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

const PLATFORM_LABELS: Record<string, string> = {
  darwin: "macOS",
  win32: "Windows",
  linux: "Linux",
};

/** The mark each sport wears elsewhere in the app, so the colour is picked
    against the figure it will be seen on. The sentence of examples that used to
    sit beside each one is gone with the rows it needed: the label already names
    the sport. */
const SPORT_COLOR_ICONS: Record<SportColorCategory, LucideIcon> = {
  strength: Dumbbell,
  trail: Mountain,
  run: RunnerIcon,
  bike: Bike,
  other: Ellipsis,
};

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

function platformLabel(info: AppInfo): string {
  const name = PLATFORM_LABELS[info.platform] ?? info.platform;
  return `${name} (${info.arch})`;
}

interface SettingsViewProps {
  api: CorosLinkApi;
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
  const [mcpModalOpen, setMcpModalOpen] = useState(false);
  const [mcpSummary, setMcpSummary] = useState<McpSummary | null>(null);
  const [mcpRefreshVersion, setMcpRefreshVersion] = useState(0);
  const [coachModelsOpen, setCoachModelsOpen] = useState(false);
  const [coachModels, setCoachModels] = useState<CoachModelsSummary | null>(null);
  const [coachRefreshVersion, setCoachRefreshVersion] = useState(0);
  const { theme, setTheme, accent, setAccent } = useTheme();
  const [sportColors, setSportColors] = useState(() => readStoredSportColors());

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

  // Capitalised so JSX renders it as a component, not an element name.
  const StartupViewIcon = getPrimaryViewIcon(startupView);

  const updateStatusText =
    updateSnapshot.status === "available" ||
    updateSnapshot.status === "downloading"
      ? `Version ${updateSnapshot.availableVersion} is available.`
      : updateSnapshot.status === "downloaded"
        ? `Version ${updateSnapshot.availableVersion} is ready to install.`
        : updateSnapshot.status === "not-available"
          ? "You're on the latest version."
          : null;

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
            <h3>Heracles Records</h3>
            <p>
              Unofficial COROS companion for media, watch sync, and training
              analytics.
            </p>
            {updateStatusText ? (
              <p className="settings-update-status">{updateStatusText}</p>
            ) : null}
          </div>
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

        <dl className="settings-version-grid">
          <div>
            <dt>App version</dt>
            <dd>{appInfo?.version ?? updateSnapshot.currentVersion}</dd>
          </div>
          <div>
            <dt>Platform</dt>
            <dd>{appInfo ? platformLabel(appInfo) : "Not available"}</dd>
          </div>
          <div>
            <dt>Electron</dt>
            <dd>{appInfo?.electronVersion ?? "Not available"}</dd>
          </div>
          <div>
            <dt>Chromium</dt>
            <dd>{appInfo?.chromeVersion ?? "Not available"}</dd>
          </div>
          <div>
            <dt>Node.js</dt>
            <dd>{appInfo?.nodeVersion ?? "Not available"}</dd>
          </div>
        </dl>

        <div className="settings-about-links">
          {ABOUT_LINKS.map(({ label, href, icon: Icon }) => (
            <a
              key={href}
              className="settings-about-link"
              href={href}
              target="_blank"
              rel="noreferrer"
            >
              <Icon size={15} aria-hidden="true" />
              <span>{label}</span>
              <ExternalLink size={12} aria-hidden="true" />
            </a>
          ))}
          <ResourcesMenu />
        </div>

        <div className="settings-startup-row">
          <span className="settings-startup-icon" aria-hidden="true">
            <StartupViewIcon size={22} strokeWidth={1.9} />
          </span>
          <span className="settings-startup-copy">
            <strong>Startup view</strong>
            <span>The screen Heracles Records opens on next launch.</span>
          </span>
          <StartupViewMenu
            labeled
            value={startupView}
            onChange={onStartupViewChange}
            showDevelopmentItems={showDevelopmentTools}
          />
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

      <div className="panel settings-appearance-panel">
        {/* Both axes of the theme on one line: the mode switch, the five
            palettes as swatches, and the selected palette named beside them.
            The palettes were five 220px cards carrying a sentence apiece —
            "Cool and low-glare for long sessions" — which is read once and
            never again, and which cost the section four hundred pixels for a
            choice made by looking at the colour. The sentence is not lost: the
            active one is shown under the row, and each swatch carries its own
            as a title. */}
        <div className="settings-appearance-head">
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
        </div>

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
                ? `Downloads, projects, caches and app data — ${appInfo.storageLocations.length} locations.`
                : "Downloads, projects, caches and app data."}
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

      <CoachModelsModal
        api={api}
        open={coachModelsOpen}
        onClose={() => setCoachModelsOpen(false)}
        onChange={() => setCoachRefreshVersion((version) => version + 1)}
      />
    </section>
  );
}
