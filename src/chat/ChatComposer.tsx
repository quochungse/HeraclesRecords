import { Loader2, Send, Settings2, Square } from "lucide-react";
import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode
} from "react";

export function isLatestActivityFileRequest(text: string): boolean {
  const normalized = text.toLowerCase();
  return (
    /\b(download|export|save|get|grab)\b/.test(normalized) &&
    /\b(latest|last|most recent|newest|recent)\b/.test(normalized) &&
    /\b(activity|workout|run|ride)\b/.test(normalized) &&
    /\b(file|fit|original)\b/.test(normalized)
  );
}

export interface ChatComposerHandle {
  focus: () => void;
  setDraft: (value: string) => void;
}

interface ChatComposerProps {
  /** The AI this conversation answers with, and the way to change it. */
  providerControls: ReactNode;
  /** What the next question is about, as a header on the box. */
  attachments?: ReactNode;
  /** The placeholder for what it points at: "Ask about this week…". */
  placeholder?: string;
  /** Opens Coach settings. */
  onOpenSettings: () => void;
  initialDraft: string;
  apiAvailable: boolean;
  streaming: boolean;
  /** Stop was pressed and the turn has not ended yet. */
  stopping?: boolean;
  /** Why sending waits, as a sentence: another conversation's turn is running (UAT). */
  blockedReason?: string;
  /** A send tried while blocked: the view says why, as a toast. */
  onBlocked?: () => void;
  exportingLatestActivity: boolean;
  waitingForCoachAnswer: boolean;
  isLocalProvider: boolean;
  localModelConfigured: boolean;
  onDraftChange: (value: string) => void;
  onSend: (message: string) => Promise<boolean>;
  onStop: () => void;
}

/**
 * Where the next turn is written (Coach Workbench review, R1): one box, with
 * what the question is about above the words and the AI that will answer
 * below them.
 *
 * It was a toolbar of three large pickers and a second New chat button over
 * the input, and a disclaimer under it — 135 px of a 900 px window, and the
 * pickers named Coach's settings rather than the AI that would answer. New
 * chat lives at the head of the conversation list now, and the disclaimer on
 * the empty conversation, where it is read once.
 */
export const ChatComposer = forwardRef<ChatComposerHandle, ChatComposerProps>(
  function ChatComposer(
    {
      providerControls,
      attachments,
      placeholder,
      onOpenSettings,
      initialDraft,
      apiAvailable,
      streaming,
      stopping = false,
      blockedReason,
      onBlocked,
      exportingLatestActivity,
      waitingForCoachAnswer,
      isLocalProvider,
      localModelConfigured,
      onDraftChange,
      onSend,
      onStop
    },
    ref
  ) {
    const [draft, setDraft] = useState(initialDraft);
    const draftRef = useRef(initialDraft);
    const submittingRef = useRef(false);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const trimmedDraft = draft.trim();
    const latestActivityFileRequest = isLatestActivityFileRequest(trimmedDraft);
    const localProviderBlocked =
      isLocalProvider &&
      !localModelConfigured &&
      !latestActivityFileRequest;

    const updateDraft = useCallback(
      (value: string) => {
        draftRef.current = value;
        setDraft(value);
        onDraftChange(value);
      },
      [onDraftChange]
    );

    useImperativeHandle(
      ref,
      () => ({
        focus: () => textareaRef.current?.focus(),
        setDraft: updateDraft
      }),
      [updateDraft]
    );

    const submitDraft = async () => {
      if (blockedReason && trimmedDraft) {
        // The words stay; only the send waits.
        onBlocked?.();
        return;
      }
      if (
        !apiAvailable ||
        !trimmedDraft ||
        exportingLatestActivity ||
        localProviderBlocked ||
        submittingRef.current
      ) {
        return;
      }

      const submittedDraft = draft;
      submittingRef.current = true;
      updateDraft("");
      try {
        const accepted = await onSend(trimmedDraft);
        if (!accepted && !draftRef.current) {
          updateDraft(submittedDraft);
        }
      } finally {
        submittingRef.current = false;
      }
    };

    return (
      <div className="chat-composer">
        <div className={`chat-composer-inner${attachments ? " has-refs" : ""}`}>
          {attachments}
          <textarea
            ref={textareaRef}
            className="chat-input"
            value={draft}
            onChange={(event) => updateDraft(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                void submitDraft();
              }
            }}
            placeholder={
              waitingForCoachAnswer
                ? "Type another answer…"
                : placeholder ?? "Ask Coach…"
            }
            rows={1}
            disabled={exportingLatestActivity}
          />
          <div className="chat-composer-row">
            <button
              type="button"
              className="chat-composer-settings"
              onClick={onOpenSettings}
              aria-label="Open settings"
              title="Coach settings"
            >
              <Settings2 size={14} aria-hidden="true" />
            </button>
            {providerControls}
            <span className="chat-composer-spacer" />
            {trimmedDraft && !streaming ? (
              <span className="chat-composer-hint" aria-hidden="true">
                Enter to send · Shift+Enter for a new line
              </span>
            ) : null}
            {streaming ? (
              <button
                type="button"
                className={`chat-send chat-stop${stopping ? " is-stopping" : ""}`}
                onClick={onStop}
                disabled={stopping}
                title={stopping ? "Stopping…" : "Stop"}
                aria-label={stopping ? "Stopping" : "Stop"}
              >
                {stopping ? (
                  <Loader2 className="chat-spinner" size={14} aria-hidden="true" />
                ) : (
                  <Square size={14} aria-hidden="true" />
                )}
              </button>
            ) : (
              <button
                type="button"
                className={`chat-send${trimmedDraft && !localProviderBlocked && !blockedReason ? " is-ready" : ""}`}
                onClick={() => void submitDraft()}
                disabled={
                  !apiAvailable ||
                  Boolean(blockedReason) ||
                  !trimmedDraft ||
                  exportingLatestActivity ||
                  localProviderBlocked
                }
                title={
                  blockedReason
                    ? blockedReason
                    : localProviderBlocked
                      ? "Enter a local model first"
                      : "Send"
                }
                aria-label="Send"
              >
                <Send size={14} aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }
);
