// Selected COROS catalog metadata, read 2026-10-27. Tests share these rows;
// production reads the catalog and the Exercises Library's existing review.
export const strengthExerciseOptions = [
  { id: "425831217146019840", corosKey: "T1041", name: "Bench Press", primaryMuscles: [2], involvedMuscles: [2, 4] },
  { id: "425832054396207105", corosKey: "T1061", name: "Squats", primaryMuscles: [8], involvedMuscles: [7, 8, 14] },
  { id: "425827856334110721", corosKey: "T1010", name: "Planks", primaryMuscles: [6], involvedMuscles: [6, 13] },
  { id: "426801647558246401", corosKey: "T1164", name: "Split Bench Squat", primaryMuscles: [7], involvedMuscles: [7, 14] },
  { id: "469664891494645760", corosKey: "T1368", name: "Copenhagen Plank", primaryMuscles: [6], involvedMuscles: [6, 13, 14, 9] },
  { id: "425898928110747648", corosKey: "T1120", name: "Warm Up", primaryMuscles: [], involvedMuscles: [], corosExerciseType: 1 }
];

export function strengthExerciseMetadata(key) {
  const option = strengthExerciseOptions.find((row) => row.corosKey === key);
  if (!option) return {};
  return {
    externalId: option.id,
    corosKey: option.corosKey,
    primaryMuscles: option.primaryMuscles,
    involvedMuscles: option.involvedMuscles,
    corosExerciseType: option.corosExerciseType ?? 2
  };
}
