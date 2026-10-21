// The demo's today is always a Saturday. Every sample set is dated back from
// today on its own — road runs, trail runs, hikes, rides — and the demo keeps
// one outdoor session a day (demoData.ts), so on most other weekdays they land
// on each other's days and a hike or a ride the shots open (Fansipan, the Ba Vì
// long ride) is dropped. So the clock is moved back to the last Saturday at the
// same time of day, before anything reads it: this module is main.tsx's first
// import.

const DAY_MS = 86_400_000;
const sinceSaturday = (new Date().getDay() + 1) % 7;

if (sinceSaturday > 0) {
  const NativeDate = Date;
  const nativeNow = NativeDate.now.bind(NativeDate);
  const shift = sinceSaturday * DAY_MS;
  class DemoDate extends NativeDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(nativeNow() - shift);
      else super(...(args as [string | number]));
    }
    static now(): number {
      return nativeNow() - shift;
    }
  }
  globalThis.Date = DemoDate as DateConstructor;
}

export {};
