import { ChevronDown, PanelLeft, PanelLeftClose } from "lucide-react";
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
  findPrimaryNavGroupId,
  PRIMARY_NAV_GROUPS,
  SIDEBAR_COLLAPSED_WIDTH,
  SIDEBAR_EXPANDED_WIDTH,
  type PrimaryNavGroupId,
  type PrimaryNavItem,
  type PrimaryView,
  visiblePrimaryNavTree,
} from "../navigation/primaryNav";

const SIDEBAR_COLLAPSED_KEY = "coroslink.sidebarCollapsed";
const SIDEBAR_COLLAPSED_GROUPS_KEY = "coroslink.sidebarCollapsedGroups";

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

/** Indicator lookup key: a destination id, or `group:<id>` for a group header. */
type NavRowKey = string;

function groupRowKey(groupId: PrimaryNavGroupId): NavRowKey {
  return `group:${groupId}`;
}

/**
 * Distance from `nav`'s content box down to `element`, summed across the
 * offsetParent chain. A nested row's offsetParent is its group container (which
 * is positioned, to hang the rail off), so a bare `offsetTop` would be measured
 * against the group rather than the nav and put the indicator in the wrong place.
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

function readCollapsedGroups(): PrimaryNavGroupId[] {
  try {
    const stored = localStorage.getItem(SIDEBAR_COLLAPSED_GROUPS_KEY);
    if (!stored) {
      return [];
    }

    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return PRIMARY_NAV_GROUPS.map((group) => group.id).filter((id) =>
      parsed.includes(id),
    );
  } catch {
    return [];
  }
}

function writeCollapsedGroups(groupIds: PrimaryNavGroupId[]): void {
  try {
    localStorage.setItem(
      SIDEBAR_COLLAPSED_GROUPS_KEY,
      JSON.stringify(groupIds),
    );
  } catch {
    // Ignore storage failures in restricted environments.
  }
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }

    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    const media = window.matchMedia(query);
    const handleChange = () => setMatches(media.matches);

    handleChange();
    media.addEventListener("change", handleChange);

    return () => media.removeEventListener("change", handleChange);
  }, [query]);

  return matches;
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }

    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  });

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handleChange = () => setReduced(media.matches);

    handleChange();
    media.addEventListener("change", handleChange);

    return () => media.removeEventListener("change", handleChange);
  }, []);

  return reduced;
}

export interface AppSidebarProps {
  activeView: PrimaryView;
  onChange: (view: PrimaryView) => void;
  coachBusy?: boolean;
  showDevelopmentItems?: boolean;
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
  showDevelopmentItems = false,
  appLogo,
  expanded,
  onExpandedChange,
  overlayOpen,
  onOverlayOpenChange,
}: AppSidebarProps) {
  const overlayMode = useMediaQuery("(max-width: 720px)");
  const navTree = visiblePrimaryNavTree(showDevelopmentItems);
  const reducedMotion = useReducedMotion();
  const navRef = useRef<HTMLElement>(null);
  const itemRefs = useRef(new Map<NavRowKey, HTMLButtonElement>());
  const [collapsedGroups, setCollapsedGroups] = useState<PrimaryNavGroupId[]>(
    readCollapsedGroups,
  );
  const [indicator, setIndicator] = useState({
    top: 0,
    height: 0,
    ready: false,
    instant: false,
  });
  // Armed by a group toggle: the indicator should snap to the row's new spot
  // rather than slide, since the rows underneath jump rather than slide too.
  const snapIndicatorRef = useRef(false);

  const isOpen = overlayMode ? overlayOpen : true;
  const showLabels = overlayMode ? true : expanded;
  const shellWidth = overlayMode
    ? 0
    : expanded
      ? SIDEBAR_EXPANDED_WIDTH
      : SIDEBAR_COLLAPSED_WIDTH;

  // The icon-only rail has no room for group headers, so groups flatten into
  // their destinations there and the tree only appears once labels are shown.
  const flattenGroups = !showLabels;

  const activeGroupId = findPrimaryNavGroupId(activeView);
  const activeGroupCollapsed =
    !flattenGroups &&
    activeGroupId !== null &&
    collapsedGroups.includes(activeGroupId);
  const indicatorKey: NavRowKey =
    activeGroupCollapsed && activeGroupId
      ? groupRowKey(activeGroupId)
      : activeView;

  const updateIndicator = useCallback(() => {
    const nav = navRef.current;
    const activeItem = itemRefs.current.get(indicatorKey);
    if (!nav || !activeItem || !isOpen) {
      return;
    }

    const snap = snapIndicatorRef.current;
    snapIndicatorRef.current = false;

    setIndicator({
      top: offsetTopWithin(activeItem, nav),
      height: activeItem.offsetHeight,
      ready: true,
      instant: snap,
    });
  }, [coachBusy, collapsedGroups, expanded, indicatorKey, isOpen, overlayMode]);

  useLayoutEffect(() => {
    updateIndicator();
  }, [updateIndicator]);

  useEffect(() => {
    const nav = navRef.current;
    if (!nav) {
      return;
    }

    const observer = new ResizeObserver(() => updateIndicator());
    observer.observe(nav);
    for (const item of itemRefs.current.values()) {
      observer.observe(item);
    }

    window.addEventListener("resize", updateIndicator);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateIndicator);
    };
  }, [updateIndicator]);

  // Navigating into a collapsed group opens it, so the destination the app is
  // showing is never hidden behind a closed disclosure.
  useEffect(() => {
    const groupId = findPrimaryNavGroupId(activeView);
    if (!groupId) {
      return;
    }

    setCollapsedGroups((current) => {
      if (!current.includes(groupId)) {
        return current;
      }

      const next = current.filter((id) => id !== groupId);
      writeCollapsedGroups(next);
      return next;
    });
  }, [activeView]);

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

  const handleToggleGroup = (groupId: PrimaryNavGroupId) => {
    snapIndicatorRef.current = true;
    setCollapsedGroups((current) => {
      const next = current.includes(groupId)
        ? current.filter((id) => id !== groupId)
        : [...current, groupId];
      writeCollapsedGroups(next);
      return next;
    });
  };

  const handleToggleExpanded = () => {
    const nextExpanded = !expanded;
    onExpandedChange(nextExpanded);
    writeSidebarCollapsed(!nextExpanded);
  };

  const widthTransition = reducedMotion
    ? { duration: 0.01 }
    : widthSpring;
  const labelTransition = reducedMotion
    ? { duration: 0.01 }
    : labelSpring;

  const registerRow = (key: NavRowKey) => (element: HTMLButtonElement | null) => {
    if (element) {
      itemRefs.current.set(key, element);
    } else {
      itemRefs.current.delete(key);
    }
  };

  const rowCopy = (
    index: number,
    label: string,
    beta: boolean,
    trailing?: ReactNode,
  ) => (
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
        delay: reducedMotion || !showLabels ? 0 : index * 0.025,
      }}
      aria-hidden={!showLabels}
    >
      <span className="app-sidebar-nav-label">{label}</span>
      {beta ? <span className="primary-tab-beta">Beta</span> : null}
      {trailing}
    </motion.span>
  );

  const renderNavItem = (
    item: PrimaryNavItem,
    index: number,
    nested: boolean,
  ) => {
    const Icon = item.icon;
    const isActive = activeView === item.id;
    const tooltip = item.beta ? `${item.label} (Beta)` : item.label;

    return (
      <button
        key={item.id}
        type="button"
        className={[
          "app-sidebar-nav-item",
          nested ? "is-nested" : "",
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
          <Icon size={18} aria-hidden="true" />
          {item.showActivity && coachBusy ? (
            <span
              className="primary-tab-activity app-sidebar-nav-activity"
              aria-label="Coach is responding"
            />
          ) : null}
        </span>
        {rowCopy(index, item.label, Boolean(item.beta))}
      </button>
    );
  };

  let rowIndex = 0;

  const navRows = navTree.flatMap((entry) => {
    if (entry.kind === "item") {
      return [renderNavItem(entry.item, rowIndex++, false)];
    }

    const { group } = entry;

    if (flattenGroups) {
      return group.items.map((item) => renderNavItem(item, rowIndex++, false));
    }

    const GroupIcon = group.icon;
    const groupOpen = !collapsedGroups.includes(group.id);
    const headerKey = groupRowKey(group.id);
    const headerIndex = rowIndex++;

    return [
      <div className="app-sidebar-nav-group" key={group.id}>
        <button
          type="button"
          className={[
            "app-sidebar-nav-item",
            "is-group",
            indicatorKey === headerKey ? "active" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          aria-expanded={groupOpen}
          ref={registerRow(headerKey)}
          onClick={() => handleToggleGroup(group.id)}
        >
          <span className="app-sidebar-nav-icon">
            <GroupIcon size={18} aria-hidden="true" />
          </span>
          {rowCopy(
            headerIndex,
            group.label,
            false,
            <ChevronDown
              className={[
                "app-sidebar-nav-chevron",
                groupOpen ? "is-open" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              size={15}
              aria-hidden="true"
            />,
          )}
        </button>

        {groupOpen ? (
          <div
            className="app-sidebar-nav-children"
            role="group"
            aria-label={group.label}
          >
            {group.items.map((item) => renderNavItem(item, rowIndex++, true))}
          </div>
        ) : null}
      </div>,
    ];
  });

  const sidebarPanel = (
    <motion.aside
      className={[
        "app-sidebar",
        overlayMode ? "is-overlay" : "",
        !overlayMode && !expanded ? "is-collapsed" : "",
        isOpen ? "is-open" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-hidden={!isOpen}
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
        </div>

        <nav
          className="app-sidebar-nav"
          aria-label="Primary"
          ref={navRef}
        >
          <span
            className="app-sidebar-indicator"
            aria-hidden="true"
            style={{
              height: `${indicator.height}px`,
              transform: `translateY(${indicator.top}px)`,
              opacity: indicator.ready ? 1 : 0,
              transition: indicator.instant ? "none" : undefined,
            }}
          />
          {navRows}
        </nav>

        {!overlayMode ? (
          <div className="app-sidebar-footer">
            <button
              type="button"
              className="app-sidebar-toggle"
              aria-expanded={expanded}
              aria-label={expanded ? "Collapse sidebar" : "Expand sidebar"}
              title={expanded ? "Collapse sidebar" : "Expand sidebar"}
              onClick={handleToggleExpanded}
            >
              {expanded ? (
                <PanelLeftClose size={18} aria-hidden="true" />
              ) : (
                <PanelLeft size={18} aria-hidden="true" />
              )}
              <motion.span
                className={[
                  "app-sidebar-toggle-label",
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
                Collapse
              </motion.span>
            </button>
          </div>
        ) : null}
      </div>
    </motion.aside>
  );

  return (
    <>
      {overlayMode ? (
        <button
          type="button"
          className={[
            "app-sidebar-overlay",
            overlayOpen ? "is-visible" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          aria-label="Close navigation"
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
