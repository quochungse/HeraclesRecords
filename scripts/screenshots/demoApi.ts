// A stand-in for the preload bridge, answering from demo data.
import type { HeraclesRecordsApi } from "../../src/heraclesrecords-api";
import { activityDetail, activitySummaries, listPage, realisticInput } from "./demoData";
import { demoHandlers } from "./demoHandlers";

const unhandled = new Set<string>();

export function installDemoApi(): void {
  const impl: Record<string, unknown> = {
    platform: "darwin",
    reportRendererError: (e: { message?: string; stack?: string }) => console.log("[demo] renderer error", e?.message, (e?.stack ?? "").split(String.fromCharCode(10)).slice(0, 6).join(" | ")),
    listTrainingHubActivities: async (page: number, size: number, startDay?: string, endDay?: string) =>
      listPage(page, size, startDay, endDay),
    getTrainingHubActivityDetail: async (id: string) => activityDetail(id),
    getActivityDetailSummaries: async (ids: string[]) => activitySummaries(ids),
    syncActivityDetailSummaries: async () => ({ computed: 0, remaining: 0, failed: 0 }),
    listRememberedMilestones: async () => realisticInput.remembered ?? [],
    ...demoHandlers()
  };
  const api = new Proxy(impl, {
    get(target, property) {
      if (typeof property !== "string") return undefined;
      if (property in target) return target[property];
      if (property.startsWith("on")) return () => () => {};
      const fallback = /^list/.test(property) ? [] : undefined;
      return async (...args: unknown[]) => {
        if (!unhandled.has(property)) {
          unhandled.add(property);
          console.log(`[demo] unhandled ${property}(${JSON.stringify(args).slice(0, 120)})`);
        }
        return fallback;
      };
    }
  });
  (window as unknown as { heraclesRecords: HeraclesRecordsApi }).heraclesRecords = api as unknown as HeraclesRecordsApi;
}
