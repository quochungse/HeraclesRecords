import { useEffect, useRef, useState } from "react";
import {
  BookOpen,
  ChevronDown,
  ExternalLink,
  LifeBuoy,
  Map as MapIcon,
  MapPin,
  Newspaper,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface ResourceLink {
  label: string;
  href: string;
  icon: LucideIcon;
}

// Curated from GitHub issue #8 (COROS resources). The fork's own links live in
// Settings → App Info alongside this menu, so only vendor documentation is here.
const COROS_LINKS: ResourceLink[] = [
  {
    label: "Getting started",
    href: "https://support.coros.com/hc/en-us/articles/38104668854676-Getting-Started",
    icon: BookOpen,
  },
  {
    label: "Release notes",
    href: "https://support.coros.com/hc/en-us/sections/20082056631700-Release-Notes-for-COROS-Devices",
    icon: Newspaper,
  },
  {
    label: "Download maps",
    href: "https://us.coros.com/maps",
    icon: MapIcon,
  },
  {
    label: "Offline maps guide",
    href: "https://support.coros.com/hc/en-us/articles/4405711354900-Downloading-Maps-to-Your-COROS-Watch",
    icon: MapPin,
  },
  {
    label: "Help & support",
    href: "https://support.coros.com/hc/en-us",
    icon: LifeBuoy,
  },
];

export function ResourcesMenu() {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

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

  return (
    <div className="resources-menu" ref={containerRef}>
      <button
        className="settings-about-link resources-menu-trigger"
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        title="COROS help and resources"
        onClick={() => setOpen((value) => !value)}
      >
        <LifeBuoy size={15} aria-hidden="true" />
        <span>COROS Help</span>
        <ChevronDown size={13} aria-hidden="true" />
      </button>

      {open ? (
        <div className="resources-popover" role="menu">
          <div className="resources-group">
            <p className="update-settings-heading">COROS</p>
            {COROS_LINKS.map(({ label, href, icon: Icon }) => (
              <a
                key={href}
                className="resources-link"
                href={href}
                target="_blank"
                rel="noreferrer"
                role="menuitem"
                onClick={() => setOpen(false)}
              >
                <Icon size={15} aria-hidden="true" />
                <span className="resources-link-label">{label}</span>
                <ExternalLink
                  size={13}
                  aria-hidden="true"
                  className="resources-link-external"
                />
              </a>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
