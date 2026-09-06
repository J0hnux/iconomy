export type LaborAssignment = Readonly<{
  assignedWorkers: number;
  requiredWorkers: number;
}>;

export type LaborStatus = "unassigned" | "shortage" | "full";

export type LaborSnapshot = Readonly<{
  totalWorkforce: number;
  assignedWorkers: number;
  unassignedWorkers: number;
  shortageBuildings: number;
}>;

function assertWorkerCount(value: number, label: string) {
  if (!Number.isInteger(value) || value < 0)
    throw new RangeError(`${label} must be a nonnegative integer.`);
}

export function laborEfficiency(
  assignedWorkers: number,
  requiredWorkers: number,
) {
  assertWorkerCount(assignedWorkers, "Assigned workers");
  if (!Number.isInteger(requiredWorkers) || requiredWorkers <= 0)
    throw new RangeError("Required workers must be a positive integer.");
  return Math.min(1, assignedWorkers / requiredWorkers);
}

export function laborStatus(
  assignedWorkers: number,
  requiredWorkers: number,
): LaborStatus {
  const efficiency = laborEfficiency(assignedWorkers, requiredWorkers);
  if (efficiency === 0) return "unassigned";
  return efficiency < 1 ? "shortage" : "full";
}

export function advanceLaborWork(
  elapsedMs: number,
  assignedWorkers: number,
  requiredWorkers: number,
  remainder = 0,
) {
  assertWorkerCount(elapsedMs, "Elapsed time");
  assertWorkerCount(remainder, "Labor remainder");
  const efficiency = laborEfficiency(assignedWorkers, requiredWorkers);
  if (remainder >= requiredWorkers)
    throw new RangeError("Labor remainder must be below required workers.");
  if (efficiency === 0)
    return { effectiveMs: 0, remainder } as const;
  if (efficiency === 1)
    return { effectiveMs: elapsedMs, remainder } as const;
  const workNumerator = elapsedMs * assignedWorkers + remainder;
  if (!Number.isSafeInteger(workNumerator))
    throw new RangeError("Labor work exceeds safe integer precision.");
  return {
    effectiveMs: Math.floor(workNumerator / requiredWorkers),
    remainder: workNumerator % requiredWorkers,
  } as const;
}

export function validateLaborAssignment(
  totalWorkforce: number,
  assignedElsewhere: number,
  requestedWorkers: number,
  requiredWorkers: number,
) {
  assertWorkerCount(totalWorkforce, "Total workforce");
  assertWorkerCount(assignedElsewhere, "Workers assigned elsewhere");
  assertWorkerCount(requestedWorkers, "Requested workers");
  if (!Number.isInteger(requiredWorkers) || requiredWorkers <= 0)
    throw new RangeError("Required workers must be a positive integer.");
  if (requestedWorkers > requiredWorkers)
    return { valid: false, reason: `At most ${requiredWorkers} workers can be assigned here.` } as const;
  if (assignedElsewhere + requestedWorkers > totalWorkforce)
    return {
      valid: false,
      reason: `Only ${Math.max(0, totalWorkforce - assignedElsewhere)} workers are available.`,
    } as const;
  return { valid: true, reason: null } as const;
}

export function describeLabor(
  totalWorkforce: number,
  assignments: readonly LaborAssignment[],
): LaborSnapshot {
  assertWorkerCount(totalWorkforce, "Total workforce");
  let assignedWorkers = 0;
  let shortageBuildings = 0;
  for (const assignment of assignments) {
    assertWorkerCount(assignment.assignedWorkers, "Assigned workers");
    if (
      !Number.isInteger(assignment.requiredWorkers) ||
      assignment.requiredWorkers <= 0 ||
      assignment.assignedWorkers > assignment.requiredWorkers
    )
      throw new RangeError("Labor assignment exceeds building requirements.");
    assignedWorkers += assignment.assignedWorkers;
    if (assignment.assignedWorkers < assignment.requiredWorkers)
      shortageBuildings++;
  }
  if (assignedWorkers > totalWorkforce)
    throw new RangeError("Assigned workers cannot exceed total workforce.");
  return {
    totalWorkforce,
    assignedWorkers,
    unassignedWorkers: totalWorkforce - assignedWorkers,
    shortageBuildings,
  };
}
