import { simulateNetwork, summarizeNetworkFlexState } from "./network-model.js?v=20261011-2";
import { analyzeSystemOpportunity } from "./network-insights.js?v=20261011-2";

const clone = value => JSON.parse(JSON.stringify(value));
const round = value => Number(Number(value).toFixed(8));

const fields = {
  electricityPrice: { key: "sensitivity.variable.electricity_price", unit: "€/MWh", path: ["prices", "electricityPricePerMWh"], defaults: () => [20, 120, 10], perturbation: "percent", clampMin: 0 },
  centralHeatCost: { key: "sensitivity.variable.central_heat_cost", unit: "€/MWh", path: ["prices", "centralHeatCostPerMWh"], defaults: () => [10, 100, 10], perturbation: "percent", clampMin: 0 },
  wasteHeatCost: { key: "sensitivity.variable.waste_heat_cost", unit: "€/MWh", path: ["prices", "wasteHeatCostPerMWh"], defaults: () => [0, 30, 5], perturbation: "percent", clampMin: 0 },
  sourceTemperature: { key: "sensitivity.variable.source_temperature", unit: "°C", path: ["input", "wasteHeat", "injectionTemp"], defaults: value => [Math.max(0, value - 10), Math.min(85, value + 10), 2], perturbation: 5 },
  wasteHeatAvailability: { key: "sensitivity.variable.waste_heat_availability", unit: "%", path: ["input", "wasteHeat", "availabilityPercent"], defaults: () => [25, 100, 5], perturbation: 20, clamp: [0, 100] },
  sourceCapacity: { key: "sensitivity.variable.source_capacity", unit: "MWth", path: ["input", "wasteHeat", "maxPowerMW"], defaults: value => [0, Math.max(1, value * 1.5), Math.max(0.1, value / 10)], perturbation: value => Math.max(0.1, value * 0.2), clampMin: 0 },
  boosterCOP: { key: "sensitivity.variable.booster_cop", unit: "COP", path: ["input", "booster", "cop"], defaults: () => [2, 5, 0.25], perturbation: 0.5, clampMin: 1.01 },
  dcOneStageCOP: { key: "sensitivity.variable.dc_one_stage_cop", unit: "COP", path: ["input", "wasteHeat", "singleStageCOP"], defaults: value => [Math.max(1.1, value - 1), value + 1, 0.25], perturbation: 0.5, clampMin: 1.01 },
  dcStage1COP: { key: "sensitivity.variable.dc_stage1_cop", unit: "COP", path: ["input", "wasteHeat", "stage1COP"], defaults: value => [Math.max(1.1, value - 1), value + 1, 0.25], perturbation: 0.5, clampMin: 1.01 },
  dcStage2COP: { key: "sensitivity.variable.dc_stage2_cop", unit: "COP", path: ["input", "wasteHeat", "stage2COP"], defaults: value => [Math.max(1.1, value - 1), value + 1, 0.25], perturbation: 0.5, clampMin: 1.01 },
  branchMinimum: { key: "sensitivity.variable.branch_minimum", unit: "°C", defaults: value => [value - 10, value + 10, 1], perturbation: 5 },
  branchDemand: { key: "sensitivity.variable.branch_demand", unit: "kW", defaults: value => [Math.max(0, value * 0.5), value * 1.5, Math.max(1, value / 10)], perturbation: value => Math.max(1, value * 0.2), clampMin: 0 },
  outdoorTemperature: { key: "sensitivity.variable.outdoor_temperature", unit: "°C", path: ["input", "outdoorTemp"], defaults: value => [value - 15, value + 15, 2], perturbation: 5 },
  plantSupplyTemperature: { key: "sensitivity.variable.plant_supply_temperature", unit: "°C", path: ["input", "centralPlant", "supplyTemp"], defaults: value => [value - 10, value + 10, 1], perturbation: 5 },
  pathLoss: { key: "sensitivity.variable.path_loss", unit: "K", path: ["input", "wasteHeat", "lossToHMP"], defaults: value => [Math.max(0, value - 5), value + 5, 1], perturbation: 2, clampMin: 0 }
};

function resolve(variable, input, prices, branchId) {
  if (variable === "dcHPCOP") variable = input.wasteHeat.mode === "one-stage" ? "dcOneStageCOP" : input.wasteHeat.mode === "two-stage" ? "dcStage2COP" : "dcOneStageCOP";
  const field = fields[variable];
  if (!field) throw new Error("Choose a supported sensitivity variable.");
  if (variable === "dcOneStageCOP" && input.wasteHeat.mode !== "one-stage") throw new Error("One-stage COP requires the one-stage route.");
  if ((variable === "dcStage1COP" || variable === "dcStage2COP") && input.wasteHeat.mode !== "two-stage") throw new Error("Two-stage COP requires the two-stage route.");
  if (variable === "branchMinimum" || variable === "branchDemand") {
    const branch = input.branches.find(item => item.id === branchId);
    if (!branch) throw new Error("Choose branch A–F.");
    return { field, value: Number(branch[variable === "branchMinimum" ? "minimumSupplyTemp" : "demandKW"]), branchId };
  }
  const root = field.path[0] === "prices" ? prices : input;
  return { field, value: Number(field.path.slice(1).reduce((object, key) => object?.[key], root)) };
}

export function createSensitivitySpec(variable, input, prices = {}, branchId = "A", stage = "stage2") {
  if (variable === "dcHPCOP") variable = input.wasteHeat.mode === "one-stage" ? "dcOneStageCOP" : stage === "stage1" ? "dcStage1COP" : "dcStage2COP";
  const item = resolve(variable, input, prices, branchId);
  const [min, max, step] = item.field.defaults(item.value);
  return { variable, branchId: item.branchId ?? null, currentValue: item.value, min: round(min), max: round(max), step: round(step),
    unit: item.field.unit, labelKey: item.field.key };
}

export function buildSensitivityValues(min, max, step, maxPoints = 100) {
  min = Number(min); max = Number(max); step = Number(step);
  if (![min, max, step].every(Number.isFinite) || min >= max || step <= 0) throw new Error("Enter finite values with MIN below MAX and STEP above zero.");
  const count = Math.floor((max - min) / step + 1e-9) + 1;
  const total = count + (min + (count - 1) * step < max - 1e-8 ? 1 : 0);
  if (total > maxPoints) throw new Error("The range exceeds the " + maxPoints + "-point limit. Increase STEP or narrow the range.");
  const values = Array.from({ length: count }, (_, index) => round(min + index * step));
  if (values.at(-1) < max - 1e-8) values.push(round(max));
  return values;
}

export function applySensitivityValue(input, prices, spec, value) {
  if (!Number.isFinite(Number(value))) throw new Error("Sensitivity value must be finite.");
  const nextInput = clone(input), nextPrices = clone(prices ?? {}), resolvedVariable = spec.variable === "dcHPCOP"
    ? nextInput.wasteHeat.mode === "one-stage" ? "dcOneStageCOP" : spec.stage === "stage1" ? "dcStage1COP" : "dcStage2COP" : spec.variable;
  const field = fields[resolvedVariable], numeric = Number(value);
  if (!field) throw new Error("Choose a supported sensitivity variable.");
  const min = field.clamp?.[0] ?? field.clampMin, max = field.clamp?.[1];
  if (min != null && numeric < min || max != null && numeric > max) throw new Error("Sensitivity value is outside the supported input range.");
  if (spec.variable === "branchMinimum" || spec.variable === "branchDemand") {
    const branch = nextInput.branches.find(item => item.id === spec.branchId);
    if (!branch) throw new Error("Choose branch A–F.");
    branch[spec.variable === "branchMinimum" ? "minimumSupplyTemp" : "demandKW"] = numeric;
    if (spec.variable === "branchDemand") {
      const consumer = nextInput.returnNetwork?.nodes?.find(node => node.id === spec.branchId && node.type === "THREE_PIPE_CONSUMER");
      if (consumer) consumer.demandKW = numeric;
    }
  } else if (resolvedVariable === "boosterCOP") {
    nextInput.booster.cop = numeric;
    for (const booster of nextInput.gridBoosters ?? []) booster.cop = numeric;
  } else {
    const root = field.path[0] === "prices" ? nextPrices : nextInput;
    field.path.slice(1).reduce((object, key, index, path) => {
      if (index === path.length - 1) object[key] = numeric;
      return object[key];
    }, root);
  }
  return { input: nextInput, prices: nextPrices };
}

const safe = value => Number.isFinite(Number(value)) ? Number(value) : null;
function pointMetrics(state, input, prices) {
  const summary = summarizeNetworkFlexState(state, input, prices), branches = state.withBooster.afterBranches, ret = state.returnNetwork;
  const returnHeat = ret.consumers.reduce((sum, consumer) => sum + Number(consumer.allocatedKW || 0), 0);
  const topUp = ret.consumers.reduce((sum, consumer) => sum + Number(consumer.unservedKW || 0), 0);
  const primary = analyzeSystemOpportunity(input, state).primary;
  const constrained = branches.filter(branch => branch.finalMargin != null && branch.finalMargin < -1e-9).map(branch => branch.id).sort();
  return {
    status: summary.operatingPointStatus, supported: summary.networkOperatingPointSupported, primary,
    metrics: { operatingCost: safe(summary.operatingCostPerHour), usableHeat: safe(summary.usableDataCenterHeatKW),
      centralProduction: safe(summary.centralPlantActualKW), totalElectricity: safe(summary.totalSystemElectricKW),
      boosterElectricity: safe(summary.installedBoosterElectricKW), boosterDuty: safe(summary.installedBoosterThermalKW),
      constrainedBranches: constrained.length, branchesRequiringBooster: summary.branchesRequiringBooster,
      returnHeat: safe(returnHeat), supplyTopUp: safe(topUp), returnTempAtPlant: safe(ret.returnTempAtPlantC) },
    flags: { sourceEligible: Boolean(summary.selectedDataCenterPathEligible), activeBoosters: summary.activeBoosterCount,
      boosterCapacitySufficient: state.withBooster.booster.capacitySufficient, supported: summary.networkOperatingPointSupported,
      constrainedBranches: constrained, returnConsumers: ret.consumers.map(consumer => ({ id: consumer.id,
        eligible: !["NO UPSTREAM SOURCE", "TEMPERATURE TOO LOW"].includes(consumer.status) })) },
    summary
  };
}

export function calculateSensitivitySweep(input, prices, spec, values, baselineValue = spec.currentValue) {
  const baselineState = simulateNetwork(clone(input), clone(prices ?? {}));
  const baseline = { value: Number(baselineValue), ...pointMetrics(baselineState, input, prices) };
  const points = values.map(value => {
    try {
      const applied = applySensitivityValue(input, prices, spec, value);
      return { value: Number(value), ...pointMetrics(simulateNetwork(applied.input, applied.prices), applied.input, applied.prices) };
    } catch (error) {
      return { value: Number(value), status: "INVALID", supported: false, error: String(error?.message ?? error),
        primary: { type: "none" }, metrics: {}, flags: null, summary: null };
    }
  });
  return { variable: spec.variable, spec: { ...spec }, baseline, points, thresholds: detectSensitivityThresholds(points) };
}

export function detectSensitivityThresholds(points) {
  const events = [];
  for (let index = 1; index < points.length; index++) {
    const before = points[index - 1], after = points[index];
    if (!before.flags || !after.flags) continue;
    const add = (type, detail = null) => events.push({ type, value: after.value, from: before.value, detail });
    if (before.flags.sourceEligible !== after.flags.sourceEligible) add("source-eligibility", after.flags.sourceEligible);
    for (const id of new Set([...before.flags.constrainedBranches, ...after.flags.constrainedBranches]))
      if (before.flags.constrainedBranches.includes(id) !== after.flags.constrainedBranches.includes(id)) add("branch-constraint", { branchId: id, constrained: after.flags.constrainedBranches.includes(id) });
    if (before.flags.activeBoosters !== after.flags.activeBoosters) add("booster-activation", after.flags.activeBoosters);
    if (before.flags.boosterCapacitySufficient !== after.flags.boosterCapacitySufficient) add("booster-capacity", after.flags.boosterCapacitySufficient);
    if (before.flags.supported !== after.flags.supported) add("operating-point-support", after.flags.supported);
    if (JSON.stringify(before.flags.returnConsumers) !== JSON.stringify(after.flags.returnConsumers)) add("return-heat-eligibility", after.flags.returnConsumers);
  }
  return events;
}

export function summarizeSensitivitySweep(result) {
  const supported = result.points.filter(point => point.summary && point.supported);
  const costs = supported.filter(point => Number.isFinite(point.metrics.operatingCost)).slice().sort((a, b) => a.metrics.operatingCost - b.metrics.operatingCost);
  const current = result.baseline.value;
  const lower = result.points.filter(point => point.summary && point.value < current).sort((a, b) => b.value - a.value)[0] ?? null;
  const upper = result.points.filter(point => point.summary && point.value > current).sort((a, b) => a.value - b.value)[0] ?? null;
  const feasibilityRelevant = !["electricityPrice", "centralHeatCost", "wasteHeatCost", "boosterCOP", "outdoorTemperature"].includes(result.variable);
  return { baseline: result.baseline, lowest: costs[0] ?? null, highest: costs.at(-1) ?? null,
    supportedRange: feasibilityRelevant && supported.length ? [Math.min(...supported.map(point => point.value)), Math.max(...supported.map(point => point.value))] : null,
    firstTechnicalLimit: result.thresholds.find(event => ["branch-constraint", "booster-capacity", "operating-point-support"].includes(event.type)) ?? null,
    local: !lower || !upper ? null : { lower, upper,
      asymmetric: [lower, upper].some(point => point.status !== result.baseline.status
        || point.flags.sourceEligible !== result.baseline.flags.sourceEligible
        || point.flags.activeBoosters !== result.baseline.flags.activeBoosters
        || point.flags.boosterCapacitySufficient !== result.baseline.flags.boosterCapacitySufficient
        || JSON.stringify(point.flags.constrainedBranches) !== JSON.stringify(result.baseline.flags.constrainedBranches)
        || JSON.stringify(point.flags.returnConsumers) !== JSON.stringify(result.baseline.flags.returnConsumers)),
      operatingCostLowerPerUnit: (result.baseline.metrics.operatingCost - lower.metrics.operatingCost) / (current - lower.value),
      operatingCostUpperPerUnit: (upper.metrics.operatingCost - result.baseline.metrics.operatingCost) / (upper.value - current),
      usableHeatLowerPerUnit: (result.baseline.metrics.usableHeat - lower.metrics.usableHeat) / (current - lower.value),
      usableHeatUpperPerUnit: (upper.metrics.usableHeat - result.baseline.metrics.usableHeat) / (upper.value - current) },
    supportedCount: supported.length, totalCount: result.points.length };
}

export function calculateKeySensitivities(input, prices, specFactory, baselineResult) {
  const baseline = baselineResult ?? pointMetrics(simulateNetwork(clone(input), clone(prices ?? {})), input, prices);
  return ["electricityPrice", "wasteHeatAvailability", "sourceTemperature", "boosterCOP", "centralHeatCost"].flatMap(variable => {
    try {
      const field = fields[variable], spec = specFactory(variable, input, prices);
      const amount = field.perturbation === "percent" ? Math.abs(spec.currentValue) * 0.2 : typeof field.perturbation === "function" ? field.perturbation(spec.currentValue) : field.perturbation;
      const lowerBound = field.clamp?.[0] ?? field.clampMin ?? -Infinity, upperBound = field.clamp?.[1] ?? Infinity;
      const values = [Math.max(lowerBound, spec.currentValue - amount), Math.min(upperBound, spec.currentValue + amount)].filter((value, index, all) => value !== spec.currentValue && all.indexOf(value) === index);
      const sides = values.map(value => {
        try {
          const applied = applySensitivityValue(input, prices, spec, value);
          const point = pointMetrics(simulateNetwork(applied.input, applied.prices), applied.input, applied.prices);
          return { value, ...point, costDelta: point.metrics.operatingCost - baseline.metrics.operatingCost };
        } catch (error) {
          return { value, status: "INVALID", supported: false, error: String(error?.message ?? error), primary: { type: "none" }, metrics: {}, flags: null, summary: null, costDelta: null };
        }
      });
      if (!sides.length) return [];
      const impacts = sides.map(side => side.costDelta).filter(Number.isFinite);
      return [{ variable, labelKey: spec.labelKey, sides,
        nonlinear: sides.some(side => side.status !== baseline.status || !side.flags || side.flags.sourceEligible !== baseline.flags.sourceEligible
          || side.flags.activeBoosters !== baseline.flags.activeBoosters || side.flags.boosterCapacitySufficient !== baseline.flags.boosterCapacitySufficient
          || JSON.stringify(side.flags.constrainedBranches) !== JSON.stringify(baseline.flags.constrainedBranches)
          || JSON.stringify(side.flags.returnConsumers) !== JSON.stringify(baseline.flags.returnConsumers)),
        currentValue: spec.currentValue, impact: impacts.length ? Math.max(...impacts.map(Math.abs)) : 0 }];
    } catch { return []; }
  }).sort((a, b) => b.impact - a.impact);
}

export const SENSITIVITY_VARIABLES = Object.keys(fields);
