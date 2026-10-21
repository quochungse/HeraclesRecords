import {
  AlertCircle,
  AlertTriangle,
  Check,
  type LucideIcon,
  X,
} from "lucide-react";
import {
  Children,
  type CSSProperties,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  subscribeToToasts,
  type ToastAction,
  type ToastKind,
  type ToastPlacement,
  type ToastRequest,
} from "../toast";
import { t } from "../i18n/core";

interface ToastItem {
  id: number;
  kind: ToastKind;
  text: string;
  detail?: string;
  icon?: LucideIcon;
  action?: ToastAction;
  placement: ToastPlacement;
  /** Raised when the same toast is asked for again, which restarts its clock. */
  seq: number;
  leaving: boolean;
}

const TOAST_DURATION: Record<ToastKind, number> = {
  info: 4000,
  warning: 8000,
  error: 10000,
};
/** A toast that offers something to do stays long enough to reach for it. */
const ACTION_MIN_DURATION = 6000;
/** At most this many per edge; a fourth sends the oldest on its way. */
const STACK_LIMIT = 3;
/** Matches `toast-out` in styles.css, plus a frame. */
const LEAVE_MS = 160;

const KIND_ICON: Record<ToastKind, LucideIcon> = {
  info: Check,
  warning: AlertTriangle,
  error: AlertCircle,
};

function durationOf(toast: ToastItem): number {
  const base = TOAST_DURATION[toast.kind];
  return toast.action ? Math.max(base, ACTION_MIN_DURATION) : base;
}

// Drives the floating toast stacks from the app's existing message/error state,
// so every setMessage/setError call surfaces as an auto-dismissing toast — at
// the bottom, since those answer something the athlete did — and from
// `showToast`, which can say where.
export function useToaster(message: string | null, error: string | null) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextIdRef = useRef(0);
  const lastMessageRef = useRef<string | null>(null);
  const lastErrorRef = useRef<string | null>(null);

  // Dismissing only marks a toast leaving; the effect below takes it out once
  // its exit has played. Kept apart so an eviction inside an updater can do
  // the same without a side effect of its own.
  const dismissToast = useCallback((id: number) => {
    setToasts((current) =>
      current.map((toast) =>
        toast.id === id && !toast.leaving ? { ...toast, leaving: true } : toast,
      ),
    );
  }, []);

  const removalsRef = useRef(new Map<number, number>());
  useEffect(() => {
    const removals = removalsRef.current;
    for (const toast of toasts) {
      if (!toast.leaving || removals.has(toast.id)) continue;
      removals.set(
        toast.id,
        window.setTimeout(() => {
          removals.delete(toast.id);
          setToasts((current) => current.filter((item) => item.id !== toast.id));
        }, LEAVE_MS),
      );
    }
  }, [toasts]);

  useEffect(() => {
    const removals = removalsRef.current;
    return () => {
      removals.forEach((timer) => window.clearTimeout(timer));
      removals.clear();
    };
  }, []);

  const pushToast = useCallback((request: ToastRequest) => {
    const placement = request.placement ?? "bottom";
    setToasts((current) => {
      // The same sentence twice (a background load failing on every retry)
      // is one toast whose clock starts again, not a column of copies.
      const same = current.find(
        (toast) =>
          !toast.leaving &&
          toast.placement === placement &&
          toast.kind === request.kind &&
          toast.text === request.text &&
          toast.detail === request.detail,
      );
      if (same) {
        return current.map((toast) =>
          toast === same
            ? { ...toast, action: request.action, seq: toast.seq + 1 }
            : toast,
        );
      }
      const onEdge = current.filter(
        (toast) => !toast.leaving && toast.placement === placement,
      );
      const evicted = onEdge.length >= STACK_LIMIT ? onEdge[0].id : undefined;
      nextIdRef.current += 1;
      return [
        ...current.map((toast) =>
          toast.id === evicted ? { ...toast, leaving: true } : toast,
        ),
        {
          id: nextIdRef.current,
          kind: request.kind,
          text: request.text,
          detail: request.detail,
          icon: request.icon,
          action: request.action,
          placement,
          seq: 0,
          leaving: false,
        },
      ];
    });
  }, []);

  // Refs guard against StrictMode's double-invoke and repeated identical values
  // (e.g. the same COROS error twice) while still re-toasting after the source clears.
  useEffect(() => {
    if (message && message !== lastMessageRef.current) {
      pushToast({ kind: "info", text: message });
    }
    lastMessageRef.current = message;
  }, [message, pushToast]);

  useEffect(() => {
    if (error && error !== lastErrorRef.current) {
      pushToast({ kind: "error", text: error });
    }
    lastErrorRef.current = error;
  }, [error, pushToast]);

  // Toasts raised from outside App's own message/error state — nested views
  // that have no path to it, and App's own unasked notices. Same stacks.
  useEffect(() => subscribeToToasts(pushToast), [pushToast]);

  return { toasts, dismissToast };
}

interface ToastFrame {
  left: number;
  width: number;
  top: number;
  bottom: number;
}

/**
 * The stacks are centred on the content column, not the window, so a toast
 * sits under the work rather than half over the rail. A screen with something
 * the athlete types into at its foot marks it `data-toast-floor` (Coach's
 * composer), and the bottom stack waits above it instead of covering it.
 */
function measureFrame(frame: HTMLElement | null): ToastFrame {
  const rect = frame?.getBoundingClientRect();
  const viewportHeight = window.innerHeight;
  let bottom = 20;
  for (const floor of document.querySelectorAll<HTMLElement>("[data-toast-floor]")) {
    if (floor.getClientRects().length === 0) continue;
    bottom = Math.max(bottom, Math.round(viewportHeight - floor.getBoundingClientRect().top + 12));
    break;
  }
  return {
    left: Math.round(rect?.left ?? 0),
    width: Math.round(rect?.width ?? window.innerWidth),
    top: Math.round((rect?.top ?? 0) + 16),
    bottom,
  };
}

function sameFrame(a: ToastFrame, b: ToastFrame) {
  return a.left === b.left && a.width === b.width && a.top === b.top && a.bottom === b.bottom;
}

function useToastFrame(frameRef: RefObject<HTMLElement | null>, active: boolean) {
  const [frame, setFrame] = useState<ToastFrame | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const floorsRef = useRef<HTMLElement[]>([]);

  const remeasure = useCallback(() => {
    const next = measureFrame(frameRef.current);
    setFrame((current) => (current && sameFrame(current, next) ? current : next));
  }, [frameRef]);

  // Every render while something is shown: a view change moves the floor in
  // or out, and it is a handful of rect reads. A floor that came in since is
  // watched too — a composer grows with its words — including one mounted
  // after the toast was, as Coach's is when the athlete opens it.
  useLayoutEffect(() => {
    if (!active) return;
    const floors = [...document.querySelectorAll<HTMLElement>("[data-toast-floor]")];
    const watched = floorsRef.current;
    if (floors.length !== watched.length || floors.some((floor, index) => floor !== watched[index])) {
      watched.forEach((floor) => observerRef.current?.unobserve(floor));
      floors.forEach((floor) => observerRef.current?.observe(floor));
      floorsRef.current = floors;
    }
    remeasure();
  });

  useEffect(() => {
    if (!active) return;
    window.addEventListener("resize", remeasure);
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(remeasure);
    observerRef.current = observer;
    if (frameRef.current) observer?.observe(frameRef.current);
    // The layout effect ran first and found the floors with no observer yet.
    floorsRef.current.forEach((floor) => observer?.observe(floor));
    return () => {
      window.removeEventListener("resize", remeasure);
      observer?.disconnect();
      observerRef.current = null;
      floorsRef.current = [];
    };
  }, [active, frameRef, remeasure]);

  return frame;
}

/** A clock that stops while the window is not in front: nobody is reading it. */
function useWindowFocused() {
  const [focused, setFocused] = useState(() => document.hasFocus());
  useEffect(() => {
    const onFocus = () => setFocused(true);
    const onBlur = () => setFocused(false);
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
    };
  }, []);
  return focused;
}

export function Toaster({
  toasts,
  onDismiss,
  frameRef,
  topChildren,
}: {
  toasts: ToastItem[];
  onDismiss: (id: number) => void;
  /** The content column the stacks are centred on. */
  frameRef: RefObject<HTMLElement | null>;
  /** Notices of another shape that come in at the top: the labour notices. */
  topChildren?: ReactNode;
}) {
  const hasTopChildren = Children.toArray(topChildren).length > 0;
  const active = toasts.length > 0 || hasTopChildren;
  const frame = useToastFrame(frameRef, active);
  const windowFocused = useWindowFocused();

  if (!active) {
    return null;
  }

  const style = (frame
    ? {
        "--toast-frame-left": `${frame.left}px`,
        "--toast-frame-width": `${frame.width}px`,
        "--toast-top": `${frame.top}px`,
        "--toast-bottom": `${frame.bottom}px`,
      }
    : {}) as CSSProperties;
  const top = toasts.filter((toast) => toast.placement === "top");
  const bottom = toasts.filter((toast) => toast.placement === "bottom");
  const card = (toast: ToastItem) => (
    <ToastCard
      key={toast.id}
      toast={toast}
      onDismiss={onDismiss}
      windowFocused={windowFocused}
    />
  );

  return (
    <div className="toast-layer" role="region" aria-label={t("app.notifications")} style={style}>
      {hasTopChildren || top.length > 0 ? (
        // Newest nearest the edge it came in from.
        <div className="toast-stack toast-stack--top">
          {topChildren}
          {[...top].reverse().map(card)}
        </div>
      ) : null}
      {bottom.length > 0 ? (
        <div className="toast-stack toast-stack--bottom">{bottom.map(card)}</div>
      ) : null}
    </div>
  );
}

function ToastCard({
  toast,
  onDismiss,
  windowFocused,
}: {
  toast: ToastItem;
  onDismiss: (id: number) => void;
  windowFocused: boolean;
}) {
  // Under the pointer or holding focus, the toast is being read: its clock
  // stops and picks up where it was, so a long error is not taken away mid-sentence.
  const [held, setHeld] = useState(false);
  const duration = durationOf(toast);
  const remainingRef = useRef(duration);

  useEffect(() => {
    remainingRef.current = duration;
  }, [toast.seq, duration]);

  useEffect(() => {
    if (toast.leaving || held || !windowFocused) return;
    const startedAt = Date.now();
    const timer = window.setTimeout(() => onDismiss(toast.id), remainingRef.current);
    return () => {
      window.clearTimeout(timer);
      remainingRef.current = Math.max(1000, remainingRef.current - (Date.now() - startedAt));
    };
  }, [toast.id, toast.seq, toast.leaving, held, windowFocused, onDismiss]);

  const Icon = toast.icon ?? KIND_ICON[toast.kind];
  return (
    <div
      className={[
        "toast",
        `toast--${toast.kind}`,
        toast.detail && "has-detail",
        toast.leaving && "is-leaving",
      ]
        .filter(Boolean)
        .join(" ")}
      role={toast.kind === "error" ? "alert" : "status"}
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setHeld(false);
      }}
    >
      <span className="toast-icon" aria-hidden="true">
        <Icon size={16} />
      </span>
      <span className="toast-body">
        <span className="toast-text">{toast.text}</span>
        {toast.detail ? <span className="toast-detail">{toast.detail}</span> : null}
      </span>
      {toast.action ? (
        <button
          className="toast-action"
          type="button"
          onClick={() => {
            onDismiss(toast.id);
            toast.action?.run();
          }}
        >
          {toast.action.label}
        </button>
      ) : null}
      <button
        className="toast-close"
        type="button"
        aria-label={t("app.dismissNotification")}
        onClick={() => onDismiss(toast.id)}
      >
        <X size={15} aria-hidden="true" />
      </button>
    </div>
  );
}
