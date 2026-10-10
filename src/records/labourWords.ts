// The Twelve Labours in the language on screen.
//
// `labours.ts` keeps them in English because the website imports it as it is
// (`site/src/pages/index.astro`, the /labours page) and must not pull the
// app's i18n runtime into its build. The app names a labour through here
// instead, so `labours.ts`'s English and `records.labour.*` in
// `messages/en/records.ts` say the same thing — `test:i18n` holds them equal.

import { t, type MessageKey } from "../i18n/core";
import type { LabourId, LabourStage } from "./labours";

type Field = "name" | "short" | "category" | "myth";

function labourText(id: LabourId, field: Field): string {
  return t(`records.labour.${id}.${field}` as MessageKey);
}

/** "The Nemean Lion". */
export function labourName(id: LabourId): string {
  return labourText(id, "name");
}

/** What a badge has room for: "Nemean Lion". */
export function labourShort(id: LabourId): string {
  return labourText(id, "short");
}

/** What the labour measures: "Strength". */
export function labourCategory(id: LabourId): string {
  return labourText(id, "category");
}

/** One line of the myth. */
export function labourMyth(id: LabourId): string {
  return labourText(id, "myth");
}

/** What a stage asks: "20 days of strength training". */
export function labourStage(id: LabourId, stage: LabourStage): string {
  return t(`records.labour.${id}.stage${stage}` as MessageKey);
}
