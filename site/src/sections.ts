// The two parts of the site with pages of their own under them: the header
// links to each part's first page, and SubNav lists the pages between them.
// sitemap.xml.ts reads the same lists, so a page added here is listed there.

export interface SectionPage {
  href: string;
  label: string;
}

export const ACTIVITIES_PAGES: readonly SectionPage[] = [
  { href: "/activities/", label: "Activities" },
  { href: "/activities/running", label: "Running" },
  { href: "/activities/cycling", label: "Cycling" },
  { href: "/activities/hiking", label: "Hiking" },
  { href: "/activities/strength/", label: "Strength" },
];

/** Heracles Training Load's formula, a page under Strength rather than a tab of its own. */
export const TRAINING_LOAD_PAGE = "/activities/strength/training-load";

export const PLAN_PAGES: readonly SectionPage[] = [
  { href: "/plan/calendar", label: "Calendar" },
  { href: "/plan/plans", label: "Plans" },
  { href: "/plan/workouts", label: "Workouts" },
  { href: "/plan/exercises", label: "Exercises Library" },
];
