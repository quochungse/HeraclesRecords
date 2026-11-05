import { useState } from "react";
import { ImageIcon } from "lucide-react";
import { useI18n } from "../i18n/useI18n";
import { ShareDialog } from "./ShareDialog";
import { useShareFacts } from "./ShareFacts";
import type { ShareSession } from "./shareTypes";

/**
 * The Create image button in a session's header, beside Ask Coach. The session is
 * built when the button is pressed, from what the page holds then, and the
 * Hall of Records adds what it knows: the record, the Labour stage, the place.
 */
export function ShareButton({ build }: { build: () => ShareSession | null }) {
  const { t } = useI18n();
  const facts = useShareFacts();
  const [session, setSession] = useState<ShareSession | null>(null);

  return (
    <>
      <button
        type="button"
        className="ghost-button activity-share"
        onClick={() => {
          const built = build();
          if (!built) return;
          const known = facts(built.activityId);
          setSession({
            ...built,
            record: built.record ?? known.record,
            labour: built.labour ?? known.labour,
            place: built.place ?? known.place
          });
        }}
      >
        <ImageIcon size={15} aria-hidden="true" />
        {t("share.button")}
      </button>
      {session ? <ShareDialog session={session} onClose={() => setSession(null)} /> : null}
    </>
  );
}
