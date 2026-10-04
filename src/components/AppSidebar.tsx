import { PanelLeft, PanelLeftClose, Settings as SettingsIcon, User } from "lucide-react";
import { motion } from "motion/react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  PRIMARY_NAV_ACCOUNT_ITEMS,
  SIDEBAR_COLLAPSED_WIDTH,
  SIDEBAR_EXPANDED_WIDTH,
  visiblePrimaryNavSections,
  type PrimaryNavItem,
  type PrimaryView,
} from "../navigation/primaryNav";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { english } from "../i18n/core";
import { useI18n } from "../i18n/useI18n";

const SIDEBAR_COLLAPSED_KEY = "heraclesrecords.sidebarCollapsed";

const widthSpring = {
  type: "spring" as const,
  stiffness: 420,
  damping: 28,
  mass: 0.8,
};

const labelSpring = {
  type: "spring" as const,
  stiffness: 520,
  damping: 36,
  mass: 0.7,
};

const overlaySpring = {
  type: "spring" as const,
  stiffness: 380,
  damping: 34,
  mass: 0.85,
};

const overlayCloseSpring = {
  type: "spring" as const,
  stiffness: 520,
  damping: 42,
  mass: 0.75,
};

const [ACCOUNT_ITEM, SETTINGS_ITEM] = PRIMARY_NAV_ACCOUNT_ITEMS;

/**
 * Distance from `nav`'s content box down to `element`, summed across the
 * offsetParent chain. A row's offsetParent is its section container (which is
 * positioned, so the collapsed rail can hang a divider off it), so a bare
 * `offsetTop` would be measured against the section rather than the nav and put
 * the mark in the wrong place.
 */
function offsetTopWithin(element: HTMLElement, nav: HTMLElement): number {
  let top = 0;
  let node: HTMLElement | null = element;

  while (node && node !== nav) {
    top += node.offsetTop;
    node = node.offsetParent as HTMLElement | null;
  }

  return top;
}

function readSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
}

function writeSidebarCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed));
  } catch {
    // Ignore storage failures in restricted environments.
  }
}

/** Up to two letters for the avatar an account has not set a picture on. */
function initialsFrom(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return "";
  }

  const letters =
    words.length === 1
      ? words[0].slice(0, 2)
      : `${words[0][0]}${words[words.length - 1][0]}`;

  return letters.toLocaleUpperCase();
}

const NO_HIDDEN_VIEWS: readonly PrimaryView[] = [];

export interface AppSidebarProps {
  activeView: PrimaryView;
  onChange: (view: PrimaryView) => void;
  coachBusy?: boolean;
  /**
   * A count of something new behind a destination — the Hall of Records'
   * unseen milestones. Drawn as "N new" beside the label, and as a dot on the
   * icon while the rail is collapsed.
   */
  newCounts?: Partial<Record<PrimaryView, number>>;
  showDevelopmentItems?: boolean;
  /** Destinations taken off the rail in Settings → Navigation. */
  hiddenViews?: readonly PrimaryView[];
  /** COROS nickname, or whatever the account is best known by. */
  athleteName?: string | null;
  /** COROS-hosted avatar; initials stand in when there is none. */
  athleteAvatarUrl?: string | null;
  appLogo: string;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  overlayOpen: boolean;
  onOverlayOpenChange: (open: boolean) => void;
}

export function AppSidebar({
  activeView,
  onChange,
  coachBusy = false,
  newCounts,
  showDevelopmentItems = false,
  hiddenViews = NO_HIDDEN_VIEWS,
  athleteName = null,
  athleteAvatarUrl = null,
  appLogo,
  expanded,
  onExpandedChange,
  overlayOpen,
  onOverlayOpenChange,
}: AppSidebarProps) {
  const overlayMode = useMediaQuery("(max-width: 720px)");
  /**
   * Under 1024px the rail stands as icons whatever the athlete chose. The
   * window's minimum is 900px, and a 236px column there left the screen beside
   * it one or two words a line. The stored choice is untouched: the toggle
   * opens the rail for the moment (`compactPeek`), and a wider window brings
   * the athlete's own setting back.
   */
  const compact = useMediaQuery("(max-width: 1024px)");
  const [compactPeek, setCompactPeek] = useState(false);
  useEffect(() => {
    if (!compact) setCompactPeek(false);
  }, [compact]);
  const railExpanded = compact ? compactPeek : expanded;
  const sections = visiblePrimaryNavSections(showDevelopmentItems, hiddenViews);
  /** Which rows are drawn, as a value: a row shown or hidden moves the ones
      below it and may start or stop the index scrolling, without the nav's own
      box changing size — so the measuring effects re-run on it. */
  const rowsKey = sections
    .map((section) => section.items.map((item) => item.id).join())
    .join("|");
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const navRef = useRef<HTMLElement>(null);
  const itemRefs = useRef(new Map<PrimaryView, HTMLButtonElement>());
  const [indicator, setIndicator] = useState({
    top: 0,
    height: 0,
    ready: false,
  });
  /**
   * Whether the index has anything hidden past its top or bottom edge. The
   * rail carries no scrollbar, so this is the only thing that says the list
   * continues — and it has to be measured rather than assumed, or the first
   * and last row would sit under a fade whenever nothing is hidden at all.
   */
  const [navFade, setNavFade] = useState({ top: false, bottom: false });

  const isOpen = overlayMode ? overlayOpen : true;
  const showLabels = overlayMode ? true : railExpanded;
  const shellWidth = overlayMode
    ? 0
    : railExpanded
      ? SIDEBAR_EXPANDED_WIDTH
      : SIDEBAR_COLLAPSED_WIDTH;

  const { t } = useI18n();
  const displayName = athleteName?.trim() || t("nav.profile");
  const initials = athleteName ? initialsFrom(athleteName) : "";

  const updateIndicator = useCallback(() => {
    const nav = navRef.current;
    const activeItem = itemRefs.current.get(activeView);
    if (!nav || !isOpen) {
      return;
    }

    // The account rows live outside the nav, so there is nothing to mark while
    // one of them is open — the row itself says so instead.
    if (!activeItem) {
      setIndicator((current) =>
        current.ready ? { ...current, ready: false } : current,
      );
      return;
    }

    setIndicator({
      top: offsetTopWithin(activeItem, nav),
      height: activeItem.offsetHeight,
      ready: true,
    });
  }, [activeView, coachBusy, railExpanded, isOpen, overlayMode]);

  const updateNavFade = useCallback(() => {
    const nav = navRef.current;
    if (!nav) {
      return;
    }

    const top = nav.scrollTop > 1;
    const bottom = nav.scrollTop + nav.clientHeight < nav.scrollHeight - 1;

    setNavFade((current) =>
      current.top === top && current.bottom === bottom
        ? current
        : { top, bottom },
    );
  }, []);

  useLayoutEffect(() => {
    updateIndicator();
    updateNavFade();
  }, [updateIndicator, updateNavFade, rowsKey]);

  useEffect(() => {
    const nav = navRef.current;
    if (!nav) {
      return;
    }

    const handleChange = () => {
      updateIndicator();
      updateNavFade();
    };

    // The rows are observed as well as the nav: a development build adds two
    // destinations without the nav's own box changing size, and that is
    // exactly when the index starts to scroll.
    const observer = new ResizeObserver(handleChange);
    observer.observe(nav);
    for (const item of itemRefs.current.values()) {
      observer.observe(item);
    }

    window.addEventListener("resize", handleChange);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", handleChange);
    };
  }, [updateIndicator, updateNavFade, rowsKey]);

  useEffect(() => {
    if (!overlayMode || !overlayOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onOverlayOpenChange(false);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [overlayMode, overlayOpen, onOverlayOpenChange]);

  const handleSelect = (view: PrimaryView) => {
    onChange(view);
    if (overlayMode) {
      onOverlayOpenChange(false);
    }
  };

  const handleToggleExpanded = () => {
    if (compact) {
      setCompactPeek((open) => !open);
      return;
    }
    const nextExpanded = !expanded;
    onExpandedChange(nextExpanded);
    writeSidebarCollapsed(!nextExpanded);
  };

  const widthTransition = reducedMotion ? { duration: 0.01 } : widthSpring;
  const labelTransition = reducedMotion ? { duration: 0.01 } : labelSpring;

  const registerRow =
    (view: PrimaryView) => (element: HTMLButtonElement | null) => {
      if (element) {
        itemRefs.current.set(view, element);
      } else {
        itemRefs.current.delete(view);
      }
    };

  const rowCopy = (index: number, label: string, trailing?: ReactNode) => (
    <motion.span
      className={["app-sidebar-nav-copy", showLabels ? "" : "is-hidden"]
        .filter(Boolean)
        .join(" ")}
      initial={false}
      animate={{
        opacity: showLabels ? 1 : 0,
        x: showLabels ? 0 : -6,
      }}
      transition={{
        ...labelTransition,
        delay: reducedMotion || !showLabels ? 0 : index * 0.02,
      }}
      aria-hidden={!showLabels}
    >
      <span className="app-sidebar-nav-label">{label}</span>
      {trailing}
    </motion.span>
  );

  let rowIndex = 0;

  const renderNavItem = (item: PrimaryNavItem) => {
    const Icon = item.icon;
    const isActive = activeView === item.id;
    const fresh = newCounts?.[item.id] ?? 0;
    const tooltip = [
      item.beta ? `${item.label} (${t("common.beta")})` : item.label,
      fresh > 0 ? t("common.newCount", { count: fresh }) : ""
    ]
      .filter(Boolean)
      .join(" · ");

    return (
      <button
        key={item.id}
        type="button"
        className={[
          "app-sidebar-nav-item",
          isActive ? "active" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        aria-current={isActive ? "page" : undefined}
        title={!showLabels ? tooltip : undefined}
        ref={registerRow(item.id)}
        onClick={() => handleSelect(item.id)}
      >
        <span className="app-sidebar-nav-icon">
          <Icon size={16} aria-hidden="true" />
          {item.showActivity && coachBusy ? (
            <span
              className="primary-tab-activity app-sidebar-nav-activity"
              aria-label={t("nav.coachResponding")}
            />
          ) : null}
          {fresh > 0 && !showLabels ? (
            <span
              className="app-sidebar-nav-dot"
              aria-label={t("common.newCount", { count: fresh })}
            />
          ) : null}
        </span>
        {rowCopy(
          rowIndex++,
          item.label,
          <>
            {item.beta ? (
              <span className="primary-tab-beta">{t("common.beta")}</span>
            ) : null}
            {fresh > 0 ? (
              <span className="app-sidebar-nav-count">
                {t("common.newCount", { count: fresh })}
              </span>
            ) : null}
          </>,
        )}
      </button>
    );
  };

  const sidebarPanel = (
    <motion.aside
      className={[
        "app-sidebar",
        overlayMode ? "is-overlay" : "",
        !overlayMode && !railExpanded ? "is-collapsed" : "",
        isOpen ? "is-open" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-hidden={!isOpen}
      /* aria-hidden alone hides the drawer from a screen reader while leaving
         thirteen buttons in the tab order off the left edge of the window —
         and focus landing inside an aria-hidden subtree is a violation Chrome
         warns about. `inert` is what takes them out of it. */
      inert={!isOpen}
      initial={false}
      animate={
        overlayMode
          ? {
              x: overlayOpen ? 0 : "-110%",
              opacity: overlayOpen ? 1 : 0,
            }
          : { x: 0, opacity: 1 }
      }
      transition={
        overlayMode
          ? reducedMotion
            ? { duration: 0.01 }
            : overlayOpen
              ? overlaySpring
              : overlayCloseSpring
          : undefined
      }
    >
      <div className="app-sidebar-inner">
        <div className="app-sidebar-brand">
          <div className="brand-mark">
            <img src={appLogo} alt="" aria-hidden="true" />
          </div>
          <motion.div
            className={[
              "app-sidebar-brand-copy",
              showLabels ? "" : "is-hidden",
            ]
              .filter(Boolean)
              .join(" ")}
            initial={false}
            animate={{
              opacity: showLabels ? 1 : 0,
              x: showLabels ? 0 : -8,
            }}
            transition={labelTransition}
            aria-hidden={!showLabels}
          >
            <strong>Heracles Records</strong>
          </motion.div>

          {/* Collapsing is done once and then forgotten, so the control shares
              the brand line instead of holding a row of its own. CSS brings it
              out on hover and on focus, in separate rules, so the keyboard path
              never depends on a pointer. */}
          {!overlayMode ? (
            <button
              type="button"
              className="app-sidebar-brand-toggle"
              aria-expanded={railExpanded}
              aria-label={railExpanded ? t("nav.collapse") : t("nav.expand")}
              title={railExpanded ? t("nav.collapse") : t("nav.expand")}
              onClick={handleToggleExpanded}
            >
              {railExpanded ? (
                <PanelLeftClose size={16} aria-hidden="true" />
              ) : (
                <PanelLeft size={16} aria-hidden="true" />
              )}
            </button>
          ) : null}
        </div>

        <nav
          className={[
            "app-sidebar-nav",
            navFade.top ? "has-fade-top" : "",
            navFade.bottom ? "has-fade-bottom" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          aria-label={t("nav.primary")}
          ref={navRef}
          onScroll={updateNavFade}
        >
          <span
            className="app-sidebar-indicator"
            aria-hidden="true"
            style={{
              height: `${indicator.height}px`,
              transform: `translateY(${indicator.top}px)`,
              opacity: indicator.ready ? 1 : 0,
            }}
          />

          {sections.map((section) => {
            const headingId = `app-sidebar-section-${section.id}`;

            return (
              <div
                className="app-sidebar-section"
                key={section.id}
                role="group"
                aria-labelledby={headingId}
              >
                <p className="app-sidebar-section-label" id={headingId}>
                  {section.label}
                </p>
                {section.items.map(renderNavItem)}
              </div>
            );
          })}
        </nav>

        {/*
          The account and its settings, at the foot of the rail where they are
          looked for — and out of the index above, which is what brings it down
          to a length that stands open.
        */}
        <div className="app-sidebar-identity">
          <button
            type="button"
            className={[
              "app-sidebar-identity-main",
              activeView === ACCOUNT_ITEM.id ? "active" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            aria-current={activeView === ACCOUNT_ITEM.id ? "page" : undefined}
            /* The row shows the athlete's name, so its destination is not
               readable from its text. The probe and anything else driving the
               rail navigate by this. */
            data-nav-label={english(ACCOUNT_ITEM.labelKey)}
            title={!showLabels ? displayName : undefined}
            onClick={() => handleSelect(ACCOUNT_ITEM.id)}
          >
            <span className="app-sidebar-identity-avatar">
              {athleteAvatarUrl ? (
                <img src={athleteAvatarUrl} alt="" referrerPolicy="no-referrer" />
              ) : initials ? (
                <span aria-hidden="true">{initials}</span>
              ) : (
                <User size={15} aria-hidden="true" />
              )}
            </span>
            <motion.span
              className={[
                "app-sidebar-identity-copy",
                showLabels ? "" : "is-hidden",
              ]
                .filter(Boolean)
                .join(" ")}
              initial={false}
              animate={{
                opacity: showLabels ? 1 : 0,
                x: showLabels ? 0 : -6,
              }}
              transition={labelTransition}
              aria-hidden={!showLabels}
            >
              {displayName}
            </motion.span>
          </button>

          <button
            type="button"
            className={[
              "app-sidebar-identity-settings",
              activeView === SETTINGS_ITEM.id ? "active" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            aria-current={activeView === SETTINGS_ITEM.id ? "page" : undefined}
            aria-label={SETTINGS_ITEM.label}
            data-nav-label={english(SETTINGS_ITEM.labelKey)}
            title={SETTINGS_ITEM.label}
            onClick={() => handleSelect(SETTINGS_ITEM.id)}
          >
            <SettingsIcon size={16} aria-hidden="true" />
          </button>
        </div>
      </div>
    </motion.aside>
  );

  return (
    <>
      {overlayMode ? (
        <button
          type="button"
          className={["app-sidebar-overlay", overlayOpen ? "is-visible" : ""]
            .filter(Boolean)
            .join(" ")}
          aria-label={t("nav.closeNavigation")}
          aria-hidden={!overlayOpen}
          tabIndex={overlayOpen ? 0 : -1}
          onClick={() => onOverlayOpenChange(false)}
        />
      ) : null}

      {overlayMode ? (
        <div className="app-sidebar-shell is-overlay-mode">{sidebarPanel}</div>
      ) : (
        <motion.div
          className="app-sidebar-shell"
          initial={false}
          animate={{ width: shellWidth }}
          transition={widthTransition}
          style={{ minWidth: 0, overflow: "hidden" }}
        >
          {sidebarPanel}
        </motion.div>
      )}
    </>
  );
}

export function createInitialSidebarExpanded(): boolean {
  return !readSidebarCollapsed();
}
