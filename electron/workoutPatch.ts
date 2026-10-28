/** Small, allowlisted edits. Arrays keep their shape; typed intensity is atomic. */
import { z } from "zod";
import { buildDraftWorkoutInputSchema } from "./workoutCapabilities";
import { editorDraftToPlanWorkoutInput, planWorkoutInputToEditorDraft } from "./planWorkoutEditor";
import type { PlanWorkoutEntryInput, RunWorkoutEditorDraft, RunWorkoutEditorNode, WorkoutPatch } from "./types";

export const WORKOUT_PATCH_PROPERTIES = {
  set: { type: "object", additionalProperties: true, description: "patch only: /paths to values; zero-based steps, e.g. /description or /steps/1/target_duration_seconds. Replace intensity as a whole object. Other fields stay." },
  unset: { type: "array", items: { type: "string" }, description: "patch only: optional field /paths to delete. No array edits, sport or identity changes." }
};

const ROOT_FIELDS = new Set(["name", "description", "distance_km", "sport_options"]);
const STEP_FIELDS = new Set([
  "name", "overview", "target_type", "target_distance_meters", "target_duration_seconds",
  "target_load", "target_hr_recovery_bpm", "target_reps", "target_elevation_gain_meters",
  "target_routes", "send_off_seconds", "intensity", "sets", "rest_type", "rest_value"
]);
const OPTIONAL_FIELDS = new Set(["description", "sport_options", "name", "overview", "intensity", "send_off_seconds", "sets", "rest_type", "rest_value"]);
const TARGET_FIELDS: Record<string, string | undefined> = {
  time: "target_duration_seconds", distance: "target_distance_meters", load: "target_load",
  hrRecovery: "target_hr_recovery_bpm", reps: "target_reps", elevationGain: "target_elevation_gain_meters",
  routes: "target_routes", open: undefined
};
const LEGACY_INTENSITY = ["pace", "intensity_type", "intensity_value", "intensity_value_extend", "intensity_display_unit", "intensity_multiplier", "intensity_custom", "hr_type", "is_intensity_percent", "intensity_percent", "intensity_percent_extend"];
type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const own = (value: object, key: string) => Object.hasOwn(value, key);

// Reuse the existing field schemas locally. None of this schema is sent to the model.
type Schema = Parameters<typeof z.fromJSONSchema>[0];
const validators = new Map<string, z.ZodType>();
function validField(kind: "root" | "step" | "repeat", field: string, value: unknown): boolean {
  const key = `${kind}.${field}`;
  let validator = validators.get(key);
  if (!validator) {
    const schema = buildDraftWorkoutInputSchema() as { properties: { workout: { properties: RecordValue } } };
    const properties = schema.properties.workout.properties;
    const variants = (properties.steps as { items: { oneOf: { properties: RecordValue }[] } }).items.oneOf;
    const fieldSchema = (kind === "root" ? properties : variants[kind === "step" ? 0 : 1].properties)[field];
    if (!fieldSchema) return false;
    validator = z.fromJSONSchema(closedFieldSchema(fieldSchema) as Schema);
    validators.set(key, validator);
  }
  return validator.safeParse(value).success;
}

// Refuse unknown keys instead of accepting a field the writer would ignore.
function closedFieldSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(closedFieldSchema);
  if (!record(value)) return value;
  return { ...Object.fromEntries(Object.entries(value).map(([key, child]) => [key, closedFieldSchema(child)])), ...(value.type === "object" ? { additionalProperties: false } : {}) };
}

export function parseWorkoutPatch(value: unknown): WorkoutPatch {
  if (!record(value)) throw new Error("Patch must be an object with set and/or unset.");
  if (value.set !== undefined && !record(value.set)) throw new Error("set must map /paths to values.");
  if (value.unset !== undefined && (!Array.isArray(value.unset) || value.unset.some((path) => typeof path !== "string"))) {
    throw new Error("unset must list /paths.");
  }
  const set = (value.set ?? {}) as RecordValue;
  const unset = (value.unset ?? []) as string[];
  const paths = [...Object.keys(set), ...unset];
  if (!paths.length || paths.length > 50) throw new Error("A patch needs 1–50 field edits.");
  const seen = new Set<string>();
  for (const path of paths) {
    if (!/^\/(?:name|description|distance_km|sport_options|steps\/(?:0|[1-9]\d*)(?:\/steps\/(?:0|[1-9]\d*))?\/[a-z_]+)$/.test(path)) {
      throw new Error(`Unsupported patch path ${path}. Read the workout for its step paths; arrays and identity cannot be patched.`);
    }
    if (seen.has(path)) throw new Error(`Duplicate patch path ${path}.`);
    seen.add(path);
  }
  return structuredClone({ set, unset });
}

export function patchTouchesSteps(patch: WorkoutPatch): boolean {
  return [...Object.keys(patch.set ?? {}), ...(patch.unset ?? [])].some((path) => path.startsWith("/steps/"));
}

export function applyWorkoutPatch(base: PlanWorkoutEntryInput, value: unknown): PlanWorkoutEntryInput {
  const patch = parseWorkoutPatch(value);
  const next = structuredClone(base);
  const changedSteps = new Set<RecordValue>();
  for (const [path, deleting] of [
    ...Object.keys(patch.set ?? {}).map((path) => [path, false] as const),
    ...(patch.unset ?? []).map((path) => [path, true] as const)
  ]) {
    const parts = path.slice(1).split("/");
    const field = parts[parts.length - 1];
    let target: RecordValue = next as unknown as RecordValue;
    let kind: "root" | "step" | "repeat" = "root";
    if (parts[0] === "steps") {
      let node = next.steps?.[Number(parts[1])];
      if (!node) throw new Error(`No step at ${path}. Read the latest workout before patching.`);
      if (parts.length === 5) {
        if (!("repeat" in node)) throw new Error(`${path} needs a repeat group.`);
        node = node.steps[Number(parts[3])];
        if (!node) throw new Error(`No step at ${path}.`);
      }
      target = node as unknown as RecordValue;
      kind = "repeat" in node ? "repeat" : "step";
      if (!(kind === "repeat" ? ["name", "repeat"].includes(field) : STEP_FIELDS.has(field))) {
        throw new Error(`Unsupported patch path ${path}.`);
      }
      if (kind === "step") changedSteps.add(target);
    } else if (!ROOT_FIELDS.has(field)) {
      throw new Error(`Unsupported patch path ${path}.`);
    }
    if (deleting) {
      if (!OPTIONAL_FIELDS.has(field) || path === "/name" || (kind === "repeat" && field !== "name")) {
        throw new Error(`Cannot unset required field ${path}.`);
      }
      delete target[field];
    } else {
      const replacement = patch.set![path];
      if (!validField(kind, field, replacement)) throw new Error(`Invalid value for ${path}; use the workout field's typed value.`);
      if (field === "target_type" && target.target_type !== replacement) {
        // A different target variant must not inherit any of the old variant's parameters.
        const prefix = path.slice(0, -field.length);
        for (const oldField of Object.values(TARGET_FIELDS)) {
          if (oldField && !own(patch.set!, prefix + oldField)) delete target[oldField];
        }
      }
      target[field] = structuredClone(replacement);
    }
    if (field === "intensity") for (const legacy of LEGACY_INTENSITY) delete target[legacy];
    if (field.startsWith("target_")) {
      delete target.target_value;
      delete target.target_display_unit;
    }
  }
  if (!next.name.trim()) throw new Error("Workout name is required.");
  for (const step of changedSteps) {
    const targetType = String(step.target_type ?? "time");
    const active = TARGET_FIELDS[targetType];
    if (!own(TARGET_FIELDS, targetType) || (active && !own(step, active))) {
      throw new Error(`Target ${targetType} requires ${active ?? "a supported target type"}.`);
    }
    for (const field of Object.values(TARGET_FIELDS)) {
      if (field && field !== active && own(step, field)) {
        // Only explicitly edited, inactive fields are errors; old redundant data is kept.
        if (Object.keys(patch.set ?? {}).some((path) => path.endsWith(`/${field}`) && resolveStep(next, path) === step)) {
          throw new Error(`${field} does not belong to target ${targetType}; set target_type too.`);
        }
      }
    }
  }
  if (next.steps?.length && Object.hasOwn(patch.set ?? {}, "/distance_km")) throw new Error("Use the step's distance target when the workout has steps.");
  return next;
}

function resolveStep(workout: PlanWorkoutEntryInput, path: string): unknown {
  const parts = path.split("/");
  const node = workout.steps?.[Number(parts[2])];
  return parts.length === 6 && node && "repeat" in node ? node.steps[Number(parts[4])] : node;
}

/** Copy only the edited fields into editor nodes, retaining COROS ids and read-only data. */
export function patchWorkoutEditorDraft(base: RunWorkoutEditorDraft, value: unknown): RunWorkoutEditorDraft {
  const patch = parseWorkoutPatch(value);
  const input = editorDraftToPlanWorkoutInput(base, { key: "patch", name: base.name });
  const changed = applyWorkoutPatch(input, patch);
  const converted = planWorkoutInputToEditorDraft(changed);
  const next = structuredClone(base);
  const fields: Record<string, string> = {
    name: "name", overview: "overview", repeat: "repeat", intensity: "intensity", sets: "sets",
    rest_type: "restType", rest_value: "restValue", send_off_seconds: "sendOffSeconds"
  };
  for (const path of [...Object.keys(patch.set ?? {}), ...(patch.unset ?? [])]) {
    if (path === "/name") { next.name = changed.name; continue; }
    if (path === "/description") { next.overview = changed.description ?? ""; continue; }
    if (path === "/sport_options") { next.sportOptions = changed.sport_options; continue; }
    if (path === "/distance_km") throw new Error("Saved workouts use step distance targets.");
    const parts = path.slice(1).split("/");
    let node: RunWorkoutEditorNode | undefined = next.nodes[Number(parts[1])];
    let from: RunWorkoutEditorNode | undefined = converted.nodes[Number(parts[1])];
    if (parts.length === 5 && node?.nodeType === "repeat" && from?.nodeType === "repeat") {
      if (!node.editable) throw new Error("This COROS repeat group is read-only.");
      node = node.steps[Number(parts[3])];
      from = from.steps[Number(parts[3])];
    }
    if (!node?.editable || !from) throw new Error("This COROS step is read-only.");
    const field = parts[parts.length - 1];
    const editorField = field.startsWith("target_") ? "target" : fields[field];
    if (!editorField) throw new Error(`Unsupported editor patch ${path}.`);
    (node as unknown as RecordValue)[editorField] = structuredClone((from as unknown as RecordValue)[editorField]);
  }
  return next;
}
