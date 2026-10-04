import { t } from "./i18n/core";
export function getTimeOfDayGreeting(
  hour: number = new Date().getHours(),
): string {
  if (hour < 12) {
    return t("app.greeting.morning");
  }

  if (hour < 17) {
    return t("app.greeting.afternoon");
  }

  return t("app.greeting.evening");
}

export function msUntilNextGreetingChange(now: Date = new Date()): number {
  const hour = now.getHours();
  const target = new Date(now);

  if (hour < 12) {
    target.setHours(12, 0, 0, 0);
  } else if (hour < 17) {
    target.setHours(17, 0, 0, 0);
  } else {
    target.setDate(target.getDate() + 1);
    target.setHours(0, 0, 0, 0);
  }

  return target.getTime() - now.getTime();
}
