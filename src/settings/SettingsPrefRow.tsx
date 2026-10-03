import type { ReactNode } from "react";

export type SettingsPrefTone = "success" | "warning" | "error" | "busy";

/**
 * A row of a Settings card: what it is on the left, its control on the right.
 * Every card on the screen is built from these, so each control starts at the
 * same edge all the way down — Navigation, Appearance, Connections and Sync.
 *
 * Navigation's "Opens on" was a label over a small trigger with the sport
 * tiles under it at three times the size, and Connections and Sync were boxed
 * rows of their own with an icon tile each; the screen read as three designs.
 *
 * `start` is for a control taller than the copy beside it, which then reads
 * from the top rather than floating against the middle of a wrap of tiles.
 * `action` sits under the copy — a Reset, which beside the tiles took a line
 * of its own whenever they wrapped. `tone` puts a dot before the title for a
 * state worth seeing at a glance (an account connected, a vault in trouble);
 * a row without one says nothing about state, which is most of them.
 */
export function SettingsPrefRow({
  title,
  detail,
  align = "center",
  tone,
  action,
  children
}: {
  title: string;
  detail?: ReactNode;
  align?: "center" | "start";
  tone?: SettingsPrefTone;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div
      className={`settings-pref-row${align === "start" ? " is-top" : ""}`}
      data-tone={tone}
    >
      <div className="settings-pref-copy">
        <strong>
          {tone ? (
            <span className="settings-pref-dot" aria-hidden="true" />
          ) : null}
          {title}
        </strong>
        {detail ? <span>{detail}</span> : null}
        {action}
      </div>
      {children ? <div className="settings-pref-control">{children}</div> : null}
    </div>
  );
}
