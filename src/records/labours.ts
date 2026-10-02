// The Twelve Labours: twelve kinds of achievement, three stages each, read off
// the same milestones the Hall of Records' timeline draws.
//
// A labour is a lens, not a second engine. `milestones.ts` tags the milestone
// that reaches a stage with `{ labour, stage }` and reports how far along the
// next stage is; this module only names the labours and folds those tags into
// a state per labour. A stage is reached by its own milestone, so the stages
// of one labour may come in any order — a month that climbs an Everest can
// come before a single 1,500 m day — and a labour reads as so many of three.

export type LabourId =
  | "lion"
  | "hydra"
  | "hind"
  | "boar"
  | "stables"
  | "birds"
  | "bull"
  | "mares"
  | "girdle"
  | "cattle"
  | "apples"
  | "cerberus";

export type LabourStage = 1 | 2 | 3;

export interface LabourDefinition {
  id: LabourId;
  /** "The Nemean Lion" */
  name: string;
  /** What a badge has room for: "Nemean Lion". */
  short: string;
  /** What the labour measures: "Strength". */
  category: string;
  /** One line of the myth, for the labour's card. */
  myth: string;
  /** What each stage asks, in order. */
  stages: readonly [string, string, string];
}

/** In the order Heracles performed them, which is the order the section reads. */
export const LABOURS: readonly LabourDefinition[] = [
  {
    id: "lion",
    name: "The Nemean Lion",
    short: "Nemean Lion",
    category: "Strength",
    myth: "Its hide turned every blade, so Heracles fought it bare-handed.",
    stages: ["First strength session", "50 strength sessions", "100 strength sessions"]
  },
  {
    id: "hydra",
    name: "The Lernaean Hydra",
    short: "Hydra",
    category: "Swimming",
    myth: "The many-headed serpent of the Lerna marshes.",
    stages: ["First swim", "1.5 km in one swim", "3.8 km in one swim"]
  },
  {
    id: "hind",
    name: "The Ceryneian Hind",
    short: "Ceryneian Hind",
    category: "Consistency",
    myth: "So swift it took a whole year of pursuit to catch.",
    stages: ["4 weeks in a row", "26 weeks in a row", "52 weeks in a row"]
  },
  {
    id: "boar",
    name: "The Erymanthian Boar",
    short: "Erymanthian Boar",
    category: "Mountains",
    myth: "Driven up Mount Erymanthos into deep snow and taken alive.",
    stages: [
      "500 m climbed in one activity",
      "1,500 m climbed in one activity",
      "8,849 m — one Everest — in a month"
    ]
  },
  {
    id: "stables",
    name: "The Augean Stables",
    short: "Augean Stables",
    category: "Volume",
    myth: "Thirty years of muck, cleared in one day by turning two rivers.",
    stages: ["100 hours of training", "500 hours of training", "1,000 hours of training"]
  },
  {
    id: "birds",
    name: "The Stymphalian Birds",
    short: "Stymphalian Birds",
    category: "Cycling",
    myth: "Bronze-beaked birds, rattled into the air and brought down.",
    stages: ["First ride", "100 km in one ride", "160 km in one ride"]
  },
  {
    id: "bull",
    name: "The Cretan Bull",
    short: "Cretan Bull",
    category: "Long runs",
    myth: "The bull from Crete roamed the mainland until it became the Bull of Marathon.",
    stages: ["Half marathon distance", "Marathon distance", "50 km in one run"]
  },
  {
    id: "mares",
    name: "The Mares of Diomedes",
    short: "Mares of Diomedes",
    category: "Speed",
    myth: "The man-eating horses of Thrace, tamed and driven home.",
    stages: [
      "Beat one of your records",
      "Beat your 5K, 10K and half marathon records",
      "Beat a record that had stood a year"
    ]
  },
  {
    id: "girdle",
    name: "The Girdle of Hippolyta",
    short: "Hippolyta",
    category: "Plans",
    myth: "The Amazon queen’s war belt, won at the end of a long campaign.",
    stages: [
      "Finish a plan of 4+ weeks at 80%",
      "Finish a plan of 8+ weeks at 85%",
      "Finish a plan of 12+ weeks at 90%"
    ]
  },
  {
    id: "cattle",
    name: "The Cattle of Geryon",
    short: "Geryon",
    category: "Exploration",
    myth: "Fetched from the edge of the western world, where he set up his Pillars.",
    stages: ["Train in 5 different places", "Train in a second country", "Train 2,700 km from home"]
  },
  {
    id: "apples",
    name: "The Apples of the Hesperides",
    short: "Hesperides",
    category: "Aerobic fitness",
    myth: "The golden apples of youth, taken while Heracles held up the sky.",
    stages: ["First VO2max reading", "2 above your first reading", "5 above your first reading"]
  },
  {
    id: "cerberus",
    name: "Cerberus",
    short: "Cerberus",
    category: "Sleep",
    myth: "The three-headed hound of the underworld, dragged into daylight.",
    stages: ["First night recorded", "7 nights in a row of 7 h+", "30 nights in a row of 7 h+"]
  }
];

const BY_ID = new Map(LABOURS.map((labour) => [labour.id, labour]));

export function labourDefinition(id: LabourId): LabourDefinition {
  const found = BY_ID.get(id);
  if (!found) throw new Error(`No labour ${id}`);
  return found;
}

export const STAGE_NUMERALS: Readonly<Record<LabourStage, string>> = {
  1: "I",
  2: "II",
  3: "III"
};

/** How far along a stage not yet reached is. `ratio` 0–1, absent when there is no measure. */
export interface StageProgress {
  /** "38 / 50", "Best 1.6 km", "Your 5K record turns one on 6 Oct". */
  text: string;
  ratio?: number;
}

export interface LabourStageState {
  stage: LabourStage;
  title: string;
  /** The milestone that reached it, and when. */
  reached?: { day: string; milestoneId: string };
  progress?: StageProgress;
}

export interface LabourState {
  definition: LabourDefinition;
  stages: [LabourStageState, LabourStageState, LabourStageState];
  /** How many of the three are reached. */
  reached: number;
  complete: boolean;
}

/** A milestone, as far as the labours care. */
export interface LabourTagged {
  id: string;
  day: string;
  /** The badge's stage, and any other this one milestone reached at once. */
  labour?: { id: LabourId; stage: LabourStage; also?: LabourStage[] };
}

/** One labour stage reached: the key the notifications remember it by. */
export function labourStageKey(id: LabourId, stage: LabourStage): string {
  return `${id}:${stage}`;
}

/**
 * Each labour's three stages, the earliest milestone that reached each, and
 * the progress `milestones.ts` measured towards the ones still open.
 */
export function buildLabours(
  milestones: readonly LabourTagged[],
  progress: ReadonlyMap<string, StageProgress>
): LabourState[] {
  const reached = new Map<string, { day: string; milestoneId: string }>();
  for (const milestone of milestones) {
    if (!milestone.labour) continue;
    for (const stage of [milestone.labour.stage, ...(milestone.labour.also ?? [])]) {
      const key = labourStageKey(milestone.labour.id, stage);
      const current = reached.get(key);
      if (!current || milestone.day < current.day) {
        reached.set(key, { day: milestone.day, milestoneId: milestone.id });
      }
    }
  }

  return LABOURS.map((definition) => {
    const stages = ([1, 2, 3] as const).map((stage) => {
      const key = labourStageKey(definition.id, stage);
      const hit = reached.get(key);
      return {
        stage,
        title: definition.stages[stage - 1],
        ...(hit ? { reached: hit } : {}),
        ...(!hit && progress.has(key) ? { progress: progress.get(key) } : {})
      };
    }) as LabourState["stages"];
    const count = stages.filter((stage) => stage.reached).length;
    return { definition, stages, reached: count, complete: count === 3 };
  });
}

/** The first stage of a labour still open, which is the one worth working on. */
export function nextOpenStage(labour: LabourState): LabourStageState | undefined {
  return labour.stages.find((stage) => !stage.reached);
}
