// Hybrid Logical Clock.
//
// Three machines on three operating systems will not agree on what time it is.
// A last-writer-wins merge keyed on Date.now() therefore silently discards the
// newer edit whenever the laptop that made it happens to be running a few
// minutes behind — and the loss is invisible, because both sides "succeeded".
//
// An HLC keeps wall-clock time as a hint so timestamps stay human-readable and
// roughly correct, but layers a counter on top that only ever moves forward.
// Receiving a remote timestamp drags the local clock up to meet it, so an edit
// that happened *after* another one always sorts after it, whatever the two
// machines believe about the hour.

/** A point in causal time. `device` breaks ties so the order is total. */
export interface HlcTimestamp {
  /** Wall-clock milliseconds, never allowed to move backwards. */
  readonly millis: number;
  /** Disambiguates events inside the same millisecond. */
  readonly counter: number;
  readonly device: string;
}

/** Counter width. Overflowing it would break ordering inside a millisecond, so
 *  the clock borrows from `millis` instead — see `tick`. */
const MAX_COUNTER = 0xffff;

const MILLIS_HEX_WIDTH = 12; // ms since epoch needs 11 hex digits until 10889
const COUNTER_HEX_WIDTH = 4;

/**
 * Serialise to a string that sorts lexicographically in causal order.
 *
 * Fixed-width hex is what makes that true, and it is why oplog files can be
 * named after their timestamp and listed in order by the storage layer without
 * parsing anything.
 */
export function formatHlc(timestamp: HlcTimestamp): string {
  const millis = timestamp.millis
    .toString(16)
    .padStart(MILLIS_HEX_WIDTH, "0");
  const counter = timestamp.counter
    .toString(16)
    .padStart(COUNTER_HEX_WIDTH, "0");
  return `${millis}-${counter}-${timestamp.device}`;
}

/** `<millis hex>-<counter hex>-<device>`, the shape `formatHlc` writes. */
const HLC_PATTERN = /^([0-9a-f]+)-([0-9a-f]+)-(.+)$/;

/**
 * Whether a string is a timestamp the rest of this module can read.
 *
 * Asked of anything that came off disk. `parseHlc` and `compareHlcStrings`
 * throw on a malformed one, and an entry sorted by `compareHlcStrings` is
 * sorted against every other entry in the log — so one bad line admitted into
 * the log made every subsequent pull, compaction and manual sync throw
 * identically, with the bad line still sitting in the vault. Refusing it at the
 * door costs one entry instead.
 */
export function isValidHlc(value: string): boolean {
  return HLC_PATTERN.test(value);
}

export function parseHlc(value: string): HlcTimestamp {
  const match = HLC_PATTERN.exec(value);
  if (!match) {
    throw new Error(`Malformed HLC timestamp: ${JSON.stringify(value)}`);
  }
  return {
    millis: Number.parseInt(match[1], 16),
    counter: Number.parseInt(match[2], 16),
    device: match[3]
  };
}

/** Negative when `a` happened before `b`. Total: equal timestamps require the
 *  same device, and a device never issues the same timestamp twice. */
export function compareHlc(a: HlcTimestamp, b: HlcTimestamp): number {
  if (a.millis !== b.millis) return a.millis - b.millis;
  if (a.counter !== b.counter) return a.counter - b.counter;
  return a.device < b.device ? -1 : a.device > b.device ? 1 : 0;
}

export function compareHlcStrings(a: string, b: string): number {
  return compareHlc(parseHlc(a), parseHlc(b));
}

/** True when `candidate` is causally later than `current` (or `current` is
 *  absent). The single predicate every last-writer-wins decision goes through. */
export function isNewer(candidate: string, current: string | undefined): boolean {
  return current === undefined || compareHlcStrings(candidate, current) > 0;
}

export interface HlcClockOptions {
  readonly device: string;
  /** Injected so tests can run a machine's clock backwards on purpose. */
  readonly now?: () => number;
  /** Resume from what this device last issued, so restarting the app cannot
   *  re-issue a timestamp it has already used. */
  readonly last?: HlcTimestamp;
}

export class HlcClock {
  readonly device: string;
  readonly #now: () => number;
  #last: HlcTimestamp;

  constructor(options: HlcClockOptions) {
    if (!options.device) {
      throw new Error("An HLC clock needs a device id.");
    }
    this.device = options.device;
    this.#now = options.now ?? Date.now;
    this.#last = options.last ?? {
      millis: 0,
      counter: 0,
      device: options.device
    };
  }

  /** The last timestamp issued or observed. Persist it across restarts. */
  get last(): HlcTimestamp {
    return this.#last;
  }

  /** Issue a timestamp for a local event. */
  tick(): HlcTimestamp {
    const physical = this.#now();
    const millis = Math.max(this.#last.millis, physical);
    const counter =
      millis === this.#last.millis ? this.#last.counter + 1 : 0;
    this.#last = normalise({ millis, counter, device: this.device });
    return this.#last;
  }

  /**
   * Fold in a timestamp seen from another device.
   *
   * This is the step that makes the clock causal: after observing a remote
   * event, everything this device issues sorts after it, even if the remote
   * machine's wall clock is hours ahead of ours.
   */
  observe(remote: HlcTimestamp): HlcTimestamp {
    const physical = this.#now();
    const local = this.#last;
    const millis = Math.max(local.millis, remote.millis, physical);

    let counter: number;
    if (millis === local.millis && millis === remote.millis) {
      counter = Math.max(local.counter, remote.counter) + 1;
    } else if (millis === local.millis) {
      counter = local.counter + 1;
    } else if (millis === remote.millis) {
      counter = remote.counter + 1;
    } else {
      counter = 0;
    }

    this.#last = normalise({ millis, counter, device: this.device });
    return this.#last;
  }

  observeString(remote: string): HlcTimestamp {
    return this.observe(parseHlc(remote));
  }
}

/** Carry counter overflow into the millisecond field rather than wrapping, so
 *  more than 65 536 events in one millisecond still produce increasing
 *  timestamps instead of colliding ones. */
function normalise(timestamp: HlcTimestamp): HlcTimestamp {
  if (timestamp.counter <= MAX_COUNTER) {
    return timestamp;
  }
  return {
    millis: timestamp.millis + 1,
    counter: 0,
    device: timestamp.device
  };
}
