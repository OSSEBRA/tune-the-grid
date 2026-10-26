export const WATER_DENSITY = 1000;
export const WATER_CP = 4.186;
export const KW_PER_M3H_K = WATER_DENSITY * WATER_CP / 3600;

export function validateInputs(input) {
  const errors = [];
  const finite = ["totalFlow", "inletTemp", "boostFlow", "boostOutlet", "cop"];
  for (const key of finite) if (input[key] === "" || !Number.isFinite(Number(input[key]))) errors.push(`${key} must be a number.`);
  if (input.targetTemp !== "" && input.targetTemp != null && !Number.isFinite(Number(input.targetTemp))) errors.push("targetTemp must be a number when provided.");
  if (input.sourceTemp !== "" && input.sourceTemp != null && !Number.isFinite(Number(input.sourceTemp))) errors.push("Source-side inlet must be a number when provided.");
  if (errors.length) return errors;
  const total = Number(input.totalFlow), boost = Number(input.boostFlow), inlet = Number(input.inletTemp), outlet = Number(input.boostOutlet), cop = Number(input.cop);
  if (total <= 0) errors.push("Total network flow must be greater than 0 m³/h.");
  if (boost < 0) errors.push("Boosted flow cannot be negative.");
  if (boost > total) errors.push("Boosted flow cannot exceed total network flow.");
  if (cop <= 1) errors.push("COP must be greater than 1.");
  if (outlet < inlet) errors.push("GridBooster outlet must be at or above incoming network supply.");
  if (input.sourceTemp !== "" && input.sourceTemp != null && Number(input.sourceTemp) >= outlet) errors.push("Source-side inlet must be below booster outlet temperature.");
  return errors;
}

export function calculate(input) {
  const errors = validateInputs(input);
  if (errors.length) throw new Error(errors.join(" "));
  const total = Number(input.totalFlow), boost = Number(input.boostFlow);
  const inlet = Number(input.inletTemp), outlet = Number(input.boostOutlet), cop = Number(input.cop);
  const bypass = total - boost;
  const mixed = (boost * outlet + bypass * inlet) / total;
  const thermalPower = boost * KW_PER_M3H_K * (outlet - inlet);
  const electricPower = thermalPower / cop;
  const sourceHeat = thermalPower - electricPower;
  return { bypassFlow: bypass, mixedTemp: mixed, thermalPower, electricPower, sourceHeat,
    boostedShare: boost / total * 100, temperatureLift: outlet - inlet };
}

export function solveBoostFlow(input, targetTemp) {
  const errors = validateInputs(input);
  if (errors.length) throw new Error(errors.join(" "));
  const total = Number(input.totalFlow), inlet = Number(input.inletTemp), outlet = Number(input.boostOutlet), target = Number(targetTemp);
  if (!Number.isFinite(target) || target < inlet || target > outlet) throw new Error(`Target must be between ${inlet} °C and ${outlet} °C.`);
  if (outlet === inlet) {
    if (target === inlet) return 0;
    throw new Error("No temperature lift is available to reach this target.");
  }
  return total * (target - inlet) / (outlet - inlet);
}

export function solveBoostOutlet(input, targetTemp) {
  const errors = validateInputs(input);
  if (errors.length) throw new Error(errors.join(" "));
  const total = Number(input.totalFlow), boost = Number(input.boostFlow), inlet = Number(input.inletTemp), target = Number(targetTemp);
  if (boost <= 0) throw new Error("Boosted flow must be greater than 0 m³/h to solve outlet temperature.");
  if (!Number.isFinite(target) || target < inlet) throw new Error(`Target must be at or above network supply temperature (${inlet} °C).`);
  const outlet = inlet + (target - inlet) * total / boost;
  if (input.sourceTemp !== "" && input.sourceTemp != null && Number(input.sourceTemp) >= outlet) throw new Error("Solved booster outlet must be above source-side inlet temperature.");
  return outlet;
}

export function calculateTargetMode(input) {
  const errors = [];
  for (const key of ["totalFlow", "inletTemp", "targetTemp", "boostFlow", "cop"])
    if (input[key] === "" || !Number.isFinite(Number(input[key]))) errors.push(`${key} must be a number.`);
  if (input.sourceTemp !== "" && input.sourceTemp != null && !Number.isFinite(Number(input.sourceTemp))) errors.push("Source-side inlet must be a number when provided.");
  if (errors.length) throw new Error(errors.join(" "));
  const total = Number(input.totalFlow), inlet = Number(input.inletTemp), target = Number(input.targetTemp), boost = Number(input.boostFlow), cop = Number(input.cop);
  if (total <= 0) errors.push("Total network flow must be greater than 0 m³/h.");
  if (boost < 0) errors.push("Boosted flow cannot be negative.");
  if (boost > total) errors.push("Boosted flow cannot exceed total network flow.");
  if (cop <= 1) errors.push("COP must be greater than 1.");
  if (target < inlet) errors.push("Target mixed temperature must be at or above incoming network supply.");
  if (boost === 0 && target > inlet) errors.push("A positive boosted flow is required to raise the mixed temperature above network supply.");
  if (errors.length) throw new Error(errors.join(" "));
  if (boost === 0) throw new Error("Boosted flow must be greater than 0 m³/h to determine a booster outlet temperature.");
  const bypass = total - boost;
  const outlet = inlet + (target - inlet) * total / boost;
  if (input.sourceTemp !== "" && input.sourceTemp != null && Number(input.sourceTemp) >= outlet)
    throw new Error("Required booster outlet must be above source-side inlet temperature.");
  const thermalPower = boost * KW_PER_M3H_K * (outlet - inlet);
  const electricPower = thermalPower / cop;
  const sourceHeat = thermalPower - electricPower;
  return {
    boostOutlet: outlet,
    mixedTemp: target,
    bypassFlow: bypass,
    thermalPower,
    electricPower,
    sourceHeat,
    boostedShare: boost / total * 100,
    temperatureLift: outlet - inlet,
    mixedIfOutletOnlyTarget: (boost * target + bypass * inlet) / total
  };
}
