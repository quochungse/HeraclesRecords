// The Twelve Labours: twelve kinds of achievement, three stages each, read off
// the same milestones the Hall of Records' timeline draws.
//
// A labour is a lens, not a second engine. `milestones.ts` tags the milestone
// that reaches a stage with `{ labour, stage }` and reports how far along the
// next stage is; this module only names the labours and folds those tags into
// a state per labour. A stage is reached by its own milestone, so the stages
// of one labour may come in any order — thirty days that climb an Everest can
// come before a single 1,500 m day — and a labour reads as so many of three.
//
// **Every stage is a standard, not a first and not a gain.** Stage I asks what
// an ordinary beginner reaches with a few weeks of effort, II a few months, III
// a year. A first session is a milestone on the timeline but no stage; and a
// stage is never measured against the athlete's own past — a beginner beats
// that every week and an athlete at the top never does — so speed is age
// graded and VO2max rated for age and sex (`fitnessStandards.ts`). Lifetime
// counts are kept: years of training are the athlete's, whenever they arrive.

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
    stages: ["20 days of strength training", "100 days of strength training", "200 days of strength training"]
  },
  {
    id: "hydra",
    name: "The Lernaean Hydra",
    short: "Hydra",
    category: "Swimming",
    myth: "The many-headed serpent of the Lerna marshes.",
    stages: ["500 m in one swim", "1.5 km in one swim", "3.8 km in one swim"]
  },
  {
    id: "hind",
    name: "The Ceryneian Hind",
    short: "Ceryneian Hind",
    category: "Consistency",
    myth: "So swift it took a whole year of pursuit to catch.",
    stages: ["8 weeks in a row", "26 weeks in a row", "52 weeks in a row"]
  },
  {
    id: "boar",
    name: "The Erymanthian Boar",
    short: "Erymanthian Boar",
    category: "Mountains",
    myth: "Driven up Mount Erymanthos into deep snow and taken alive.",
    stages: [
      "750 m climbed in one activity",
      "1,500 m climbed in one activity",
      "8,849 m — one Everest — in 30 days"
    ]
  },
  {
    id: "stables",
    name: "The Augean Stables",
    short: "Augean Stables",
    category: "Volume",
    myth: "Thirty years of muck, cleared in one day by turning two rivers.",
    stages: ["50 hours of training", "250 hours of training", "500 hours of training"]
  },
  {
    id: "birds",
    name: "The Stymphalian Birds",
    short: "Stymphalian Birds",
    category: "Cycling",
    myth: "Bronze-beaked birds, rattled into the air and brought down.",
    stages: ["50 km of riding", "100 km in one ride", "160 km in one ride"]
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
      "A 45% age grade, 5K or longer",
      "A 60% age grade",
      "A 70% age grade"
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
      "Finish a plan of 12+ weeks at 85%",
      "Finish a plan of 16+ weeks at 90%"
    ]
  },
  {
    id: "cattle",
    name: "The Cattle of Geryon",
    short: "Geryon",
    category: "Exploration",
    myth: "Fetched from the edge of the western world, where he set up his Pillars.",
    stages: ["Train in 5 different places", "Train in 10 different places", "Train in 25 different places"]
  },
  {
    id: "apples",
    name: "The Apples of the Hesperides",
    short: "Hesperides",
    category: "Aerobic fitness",
    myth: "The golden apples of youth, taken while Heracles held up the sky.",
    stages: ["VO2max rated Good for your age", "VO2max rated Excellent", "VO2max rated Superior"]
  },
  {
    id: "cerberus",
    name: "Cerberus",
    short: "Cerberus",
    category: "Sleep",
    myth: "The three-headed hound of the underworld, dragged into daylight.",
    stages: ["7 nights in a row of 7 h+", "26 of 30 nights at 7 h+", "300 of 365 nights at 7 h+"]
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
