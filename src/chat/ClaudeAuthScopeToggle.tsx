import { Laptop, ShieldCheck } from "lucide-react";
import { OptionGroup } from "../components/OptionGroup";

/**
 * Picks which credential store Claude Code runs against: a Heracles
 * Records-only one, or the machine-wide login shared with the user's terminal.
 *
 * The app-scoped side leads because it is the default (`useAppScopedAuth`
 * defaults to true) and the safer of the two — picking the other one puts a
 * sign-in on top of whatever login the terminal is already using.
 *
 * Shown both in Settings and on the sign-in gate, because the choice decides
 * where a sign-in lands and is easiest to get wrong right before signing in.
 */
export function ClaudeAuthScopeToggle({
  appScoped,
  disabled,
  onChange
}: {
  appScoped: boolean;
  disabled?: boolean;
  onChange: (appScoped: boolean) => void;
}) {
  // Re-picking the active side would trigger a needless save and status re-read.
  const select = (next: boolean) => {
    if (next !== appScoped) onChange(next);
  };

  return (
    <OptionGroup
      label="Claude credentials"
      value={appScoped ? "app" : "device"}
      // The labels are short and the full sentence is the title: the long
      // spellings ("Heracles Records-only Claude login") made this the widest
      // control in Settings, for a choice of two.
      options={[
        {
          value: "app",
          label: "App only",
          title: "A Claude login this app keeps to itself",
          icon: <ShieldCheck size={14} aria-hidden="true" />
        },
        {
          value: "device",
          label: "This device",
          title: "The machine-wide Claude login your terminal already uses",
          icon: <Laptop size={14} aria-hidden="true" />
        }
      ]}
      disabled={disabled}
      onChange={(next) => select(next === "app")}
    />
  );
}
