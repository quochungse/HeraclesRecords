import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, FileDown, Loader2 } from "lucide-react";
import {
  TRAINING_HUB_EXPORT_FORMATS,
  type TrainingHubActivity,
  type TrainingHubActivityFileType
} from "../../../electron/types";

/**
 * The per-activity export menu, lifted out of the table it used to live in.
 *
 * It renders one of these per row, so it stays as small as it can be: a
 * closed menu is a button and nothing else, and the listeners below are
 * attached only while one is open.
 */
interface ActivityExportMenuProps {
  activity: TrainingHubActivity;
  activityName: string;
  busy: string | null;
  onExportFile: (
    activity: TrainingHubActivity,
    fileType: TrainingHubActivityFileType
  ) => void;
}

export function ActivityExportMenu({
  activity,
  activityName,
  busy,
  onExportFile
}: ActivityExportMenuProps) {
  const [menuPosition, setMenuPosition] = useState<{
    top: number;
    right: number;
  } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const open = menuPosition !== null;
  const isExporting = busy?.startsWith(
    `training-file:${activity.activityId}:`
  );

  useEffect(() => {
    if (!open) {
      return;
    }

    function close() {
      setMenuPosition(null);
    }

    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;
      // The menu is portaled to <body>, so check it explicitly as well.
      if (
        !containerRef.current?.contains(target) &&
        !menuRef.current?.contains(target)
      ) {
        close();
      }
    }

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        close();
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    // The activity list scrolls inside a clipped container, so a fixed menu can
    // drift away from its trigger — close it instead of tracking every frame.
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  function toggleMenu() {
    if (open) {
      setMenuPosition(null);
      return;
    }

    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }

    setMenuPosition({
      top: rect.bottom + 6,
      right: window.innerWidth - rect.right
    });
  }

  return (
    <div className="training-export-menu" ref={containerRef}>
      <button
        ref={buttonRef}
        className="icon-button training-action-button"
        type="button"
        aria-label={`Export ${activityName}`}
        title="Export activity file"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={isExporting}
        onClick={(event) => {
          event.stopPropagation();
          toggleMenu();
        }}
      >
        {isExporting ? (
          <Loader2 className="spin" size={17} aria-hidden="true" />
        ) : (
          <>
            <FileDown size={17} aria-hidden="true" />
            <ChevronDown size={13} aria-hidden="true" />
          </>
        )}
      </button>

      {menuPosition
        ? createPortal(
            <div
              ref={menuRef}
              className="training-export-dropdown"
              role="menu"
              style={{ top: menuPosition.top, right: menuPosition.right }}
            >
              <p className="training-export-dropdown-title">Export as</p>
              {TRAINING_HUB_EXPORT_FORMATS.map((format) => (
                <button
                  key={format.fileType}
                  type="button"
                  role="menuitem"
                  className="training-export-option"
                  onClick={(event) => {
                    event.stopPropagation();
                    setMenuPosition(null);
                    onExportFile(activity, format.fileType);
                  }}
                >
                  <span className="training-export-option-label">
                    {format.label}
                  </span>
                  <span className="training-export-option-desc">
                    {format.description}
                  </span>
                </button>
              ))}
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
