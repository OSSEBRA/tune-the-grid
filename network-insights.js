import {
  calculateNetworkState,
  calculateTemperatureFlexSweep,
  findPrimaryTemperatureBottleneck,
  isReturnSourceAvailableToConsumer,
  lowestSupportedPoint,
  summarizeNetworkFlexState
} from "./network-model.js?v=20261013-2";

const clone = value => globalThis.structuredClone
  ? structuredClone(value)
  : JSON.parse(JSON.stringify(value));
const finite = value => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
const number = value => finite(value) ? Number(value) : null;

export function createScenarioSnapshot(input, prices, savedAt = null) {
  return { input: clone(input), prices: clone(prices), savedAt };
}

export function saveScenarioSlot(slots, slot, input, prices, savedAt = null) {
  if (!["baseline", "optionA", "optionB"].includes(slot)) throw new RangeError("Unknown scenario slot.");
  return { ...slots, [slot]: createScenarioSnapshot(input, prices, savedAt) };
}

export function clearScenarioSlot(slots, slot) {
  if (!["baseline", "optionA", "optionB"].includes(slot)) throw new RangeError("Unknown scenario slot.");
  return { ...slots, [slot]: null };
}

export function restoreScenarioSnapshot(snapshot) {
  if (!snapshot?.input || !snapshot?.prices) throw new TypeError("A complete scenario snapshot is required.");
  return { input: clone(snapshot.input), prices: clone(snapshot.prices) };
}

function returnTopologyConstraint(input, returnState) {
  const nodes = input.returnNetwork?.nodes ?? [];
  const sources = nodes.filter(node => node.type === "WASTE_HEAT_SOURCE" && node.enabled !== false && Number(node.availableKW) > 0);
  const consumers = returnState?.nodes?.filter(node => node.type === "THREE_PIPE_CONSUMER" && Number(node.unservedKW) > 0) ?? [];
  for (const consumer of consumers) {
    const modelConsumer = nodes.find(node => node.id === consumer.id);
    const blocked = sources.find(source => Number(source.sourceTempC) >= Number(modelConsumer?.minimumUsableTempC)
      && !isReturnSourceAvailableToConsumer(source, modelConsumer));
    if (blocked) return { type: "return-topology", consumerId: consumer.id, sourceId: blocked.id, sourceTempC: Number(blocked.sourceTempC), minimumUsableTempC: Number(modelConsumer.minimumUsableTempC) };
  }
  return null;
}

export function analyzeSystemOpportunity(input, result) {
  const operating = result?.withBooster;
  if (!operating) return { primary: { type: "none" }, constraints: [] };
  const constraints = [];
  const branch = findPrimaryTemperatureBottleneck(operating.afterBranches ?? []);
  if (branch) constraints.push({ type: "branch-temperature", branchId: branch.id, branchName: branch.name,
    availableTempC: number(branch.availableSupplyTemp), requiredTempC: number(branch.minimumSupplyTemp), deficitK: Math.abs(Number(branch.finalMargin)), requiredDutyKW: number(branch.requiredBoosterPowerKW) });

  const selectedSource = operating.wasteHeat;
  const selectedSupplyHeatMode = selectedSource?.mode === "one-stage" || selectedSource?.mode === "two-stage";
  const selectedSourceEligible = selectedSource?.strictTemperatureEligible ?? selectedSource?.injectionEligible;
  if (selectedSupplyHeatMode && Number(selectedSource.availableKW) > 0 && !selectedSourceEligible) {
    const capability = number(selectedSource.contributionTemp);
    constraints.push({ type: "source-temperature", capabilityTempC: capability, targetTempC: number(operating.hmpTargetTemp),
      shortfallK: capability == null ? null : Math.max(0, Number(operating.hmpTargetTemp) - capability), sourceMode: selectedSource.mode });
  }
  const industrial = operating.industrialWasteHeat;
  if (Number(industrial?.availableKW) > 0 && !industrial.temperatureEligible) {
    const capability = number(industrial.contributionTemp);
    constraints.push({ type: "source-temperature", sourceId: "industrial-waste-heat", sourceName: "Industrial Waste Heat",
      capabilityTempC: capability, targetTempC: number(operating.hmpTargetTemp),
      shortfallK: capability == null ? null : Math.max(0, Number(operating.hmpTargetTemp) - capability) });
  }
  if (!constraints.some(constraint => constraint.type === "source-temperature") && operating.hmpTemperatureCapabilityTemp != null && !operating.hmpTemperatureReachable
    && Number(operating.hmpTemperatureCapabilityTemp) < Number(operating.hmpTargetTemp)) {
    constraints.push({ type: "source-temperature", capabilityTempC: number(operating.hmpTemperatureCapabilityTemp), targetTempC: number(operating.hmpTargetTemp),
      shortfallK: Number(operating.hmpTargetTemp) - Number(operating.hmpTemperatureCapabilityTemp), sourceMode: selectedSource?.mode });
  }
  if (Number(operating.hmpPowerShortfallKW) > 1e-8) constraints.push({ type: "source-capacity", shortfallKW: Number(operating.hmpPowerShortfallKW), availableKW: number(operating.hmpPowerAvailableKW), demandKW: number(operating.totalDemandKW) });
  const topology = returnTopologyConstraint(input, result.returnNetwork);
  if (topology) constraints.push({ type: "return-topology", ...topology });

  const primary = constraints[0] ?? { type: "none" };
  return { primary, constraints, operating, returnNetwork: result.returnNetwork };
}

export function calculateOpportunityIntervention(input, result, prices = {}) {
  const insight = analyzeSystemOpportunity(input, result);
  const primary = insight.primary;
  if (primary.type !== "branch-temperature") return { primary, resolved: false };
  const branch = input.branches.find(item => item.id === primary.branchId);
  const candidate = { id: "INSIGHT-CANDIDATE", branchId: branch.id, mode: "target",
    targetTemp: Number(branch.minimumSupplyTemp), liftK: 0,
    cop: Number(input.booster?.cop), maxThermalKW: Number(input.booster?.maxThermalKW) };
  if (!(candidate.maxThermalKW > 0) || !(candidate.cop > 0)) return { primary, resolved: false };
  const proposedInput = { ...clone(input), gridBoosters: [...(input.gridBoosters ?? []).map(item => ({ ...item })), candidate] };
  const proposedState = calculateNetworkState(proposedInput, input.hmpTargetTemp, prices);
  const proposedBranch = proposedState.withBooster.afterBranches.find(item => item.id === branch.id);
  const resolved = Number(proposedBranch?.finalMargin) >= 0;
  const baseMetrics = summarizeNetworkFlexState(result, input, prices);
  const proposedMetrics = summarizeNetworkFlexState(proposedState, proposedInput, prices);
  return {
    primary, resolved, requiredDutyKW: primary.requiredDutyKW,
    additionalUsableHeatKW: proposedMetrics.usableWasteHeatKW - baseMetrics.usableWasteHeatKW,
    centralProductionReductionKW: baseMetrics.centralPlantActualKW - proposedMetrics.centralPlantActualKW,
    additionalElectricityKW: proposedMetrics.totalSystemElectricKW - baseMetrics.totalSystemElectricKW,
    operatingBenefitPerHour: baseMetrics.operatingCostPerHour - proposedMetrics.operatingCostPerHour
  };
}

export function calculateSourceTemperatureIntervention(input, result, prices = {}, minimumTarget = 70) {
  const primary = analyzeSystemOpportunity(input, result).primary;
  if (primary.type !== "source-temperature" || !finite(primary.capabilityTempC)) return null;
  const target = Math.floor(Number(primary.capabilityTempC) - 1e-7);
  if (target < minimumTarget || target >= Number(input.hmpTargetTemp)) return null;
  const candidateInput = { ...clone(input), hmpTargetTemp: target };
  const state = calculateNetworkState(candidateInput, target, prices);
  const before = summarizeNetworkFlexState(result, input, prices);
  const after = summarizeNetworkFlexState(state, candidateInput, prices);
  return { hmpTargetTemp: target, state, metrics: after, sourceId: primary.sourceId ?? "data-center",
    additionalUsableHeatKW: after.usableWasteHeatKW - before.usableWasteHeatKW,
    centralProductionReductionKW: before.centralPlantActualKW - after.centralPlantActualKW,
    additionalElectricityKW: after.totalSystemElectricKW - before.totalSystemElectricKW,
    operatingBenefitPerHour: before.operatingCostPerHour - after.operatingCostPerHour };
}

const assumptionFields = [
  ["input.outdoorTemp", "outdoorTemperature"],
  ["input.branches", "branchInputs"],
  ["prices.electricityPricePerMWh", "electricityPrice"],
  ["prices.centralHeatCostPerMWh", "centralHeatPrice"],
  ["prices.wasteHeatCostPerMWh", "wasteHeatPrice"],
  ["input.centralPlant.maxPowerMW", "centralPlantCapacity"],
  ["input.centralPlant.supplyTemp", "centralPlantConditions"],
  ["input.centralPlant.lossToHMP", "sourcePathLosses"],
  ["input.wasteHeat.maxPowerMW", "wasteHeatAvailability"],
  ["input.wasteHeat.availabilityPercent", "wasteHeatAvailability"],
  ["input.wasteHeat.injectionTemp", "dataCenterSourceConditions"],
  ["input.wasteHeat.lossToHMP", "sourcePathLosses"],
  ["input.industrialWasteHeat.availableThermalKW", "industrialWasteHeatAvailability"],
  ["input.industrialWasteHeat.availabilityPercent", "industrialWasteHeatAvailability"],
  ["input.industrialWasteHeat.sourceTempC", "industrialWasteHeatConditions"],
  ["input.industrialWasteHeat.lossToHMP", "sourcePathLosses"],
  ["prices.industrialWasteHeatCostPerMWh", "industrialWasteHeatPrice"],
  ["input.normalPlantSupplyTemp", "plantRampConditions"],
  ["input.maxRampedPlantSupplyTemp", "plantRampConditions"],
  ["input.plantRampCostPerMWhPerK", "plantRampConditions"],
  ["input.centralPlant.availabilityPercent", "centralPlantAvailability"],
  ["input.returnNetwork", "returnNetworkInputs"]
];

function pathValue(snapshot, path) {
  return path.split(".").reduce((value, key) => value?.[key], snapshot);
}

function assumptionValue(snapshot, path, assumptionKey) {
  const value = pathValue(snapshot, path);
  if (assumptionKey !== "returnNetworkInputs" || !value) return value;
  const dataCenterReturn = value.nodes?.find(node => node.id === "DC-RETURN");
  return {
    baseReturnTempC: value.baseReturnTempC,
    returnFlowM3h: value.returnFlowM3h,
    nodes: (value.nodes ?? []).filter(node => node.id !== "DC-RETURN"),
    dataCenterReturnMaxInjectionKW: dataCenterReturn?.maxInjectionKW
  };
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${key}:${stable(value[key])}`).join(",")}}`;
  return String(value);
}

export function compareScenarioAssumptions(baseline, scenarios = []) {
  if (!baseline) return [];
  const changed = new Set();
  for (const scenario of scenarios.filter(Boolean)) {
    for (const [path, key] of assumptionFields) {
      if (stable(assumptionValue(baseline, path, key)) !== stable(assumptionValue(scenario, path, key))) changed.add(key);
    }
  }
  return [...changed];
}

export function summarizeScenarioResult(snapshot) {
  const { input, prices } = restoreScenarioSnapshot(snapshot);
  const state = calculateNetworkState(input, input.hmpTargetTemp, prices);
  const metrics = summarizeNetworkFlexState(state, input, prices);
  const operating = state.withBooster;
  const branches = operating.afterBranches ?? [];
  const returnNodes = state.returnNetwork?.nodes ?? [];
  const rawReturnSource = returnNodes.find(node => node.id === "DC-RETURN");
  const consumers = returnNodes.filter(node => node.type === "THREE_PIPE_CONSUMER");
  const demandKW = consumers.reduce((sum, node) => sum + Number(node.demandKW ?? 0), 0);
  const returnHeatKW = consumers.reduce((sum, node) => sum + Number(node.allocatedKW ?? 0), 0);
  const primary = analyzeSystemOpportunity(input, state).primary;
  return {
    input, prices, state, metrics, primary,
    hmpTargetTemp: number(operating.hmpTargetTemp),
    feasibleBranches: branches.filter(branch => branch.finalMargin != null && Number.isFinite(Number(branch.finalMargin)) && Number(branch.finalMargin) >= 0).length,
    branchesRequiringBooster: (state.without?.branches ?? []).filter(branch => branch.feasibleWithoutBooster === false).map(branch => branch.id),
    installedBoosterCount: operating.booster?.installedCount ?? input.gridBoosters?.length ?? 0,
    installedBoosterThermalKW: number(operating.booster?.thermalPowerKW) ?? 0,
    installedBoosterElectricKW: number(operating.booster?.electricalPowerKW) ?? 0,
    dataCenterMode: operating.wasteHeat?.mode ?? input.wasteHeat?.mode,
    rawReturnHeatKW: operating.wasteHeat?.mode === "raw-return" ? number(rawReturnSource?.dispatchedKW) ?? 0 : 0,
    upgradedSupplyHeatKW: operating.wasteHeat?.mode !== "raw-return" ? number(operating.wasteHeatUsedKW) ?? 0 : 0,
    dataCenterSupplyHeatKW: number(operating.wasteHeatUsedKW) ?? 0,
    industrialSupplyHeatKW: number(operating.industrialWasteHeatUsedKW) ?? 0,
    usableWasteHeatKW: number(operating.totalWasteHeatUsedKW) ?? 0,
    returnHeatKW,
    supplyTopUpKW: Math.max(0, demandKW - returnHeatKW),
    returnTempAtPlantC: number(state.returnNetwork?.returnTempAtPlantC),
    centralProductionKW: number(operating.centralPlantUsedKW),
    heatPumpElectricKW: number(operating.dataCenterElectricPowerKW),
    totalElectricKW: metrics.totalSystemElectricKW,
    operatingCostPerHour: metrics.operatingCostPerHour,
    hmpTemperatureCapabilityTemp: number(operating.hmpTemperatureCapabilityTemp),
    operatingPointStatus: metrics.operatingPointStatus
  };
}

export function compareScenarioSnapshots(slots) {
  const names = ["baseline", "optionA", "optionB"];
  const summaries = Object.fromEntries(names.map(name => [name, slots?.[name] ? summarizeScenarioResult(slots[name]) : null]));
  const baseline = summaries.baseline;
  const assumptionsDiffer = compareScenarioAssumptions(slots?.baseline, [slots?.optionA, slots?.optionB]);
  const deltas = {};
  if (baseline) for (const name of ["optionA", "optionB"]) {
    const current = summaries[name];
    if (!current) continue;
    deltas[name] = {
      usableWasteHeatKW: current.usableWasteHeatKW - baseline.usableWasteHeatKW,
      centralProductionKW: current.centralProductionKW - baseline.centralProductionKW,
      totalElectricKW: current.totalElectricKW - baseline.totalElectricKW,
      operatingCostSavingPerHour: baseline.operatingCostPerHour - current.operatingCostPerHour,
      returnHeatKW: current.returnHeatKW - baseline.returnHeatKW
    };
  }
  return { summaries, assumptionsDiffer, deltas };
}

function branchMargins(point) {
  return point?.state?.withBooster?.afterBranches ?? [];
}

function thresholdEvents(higher, lower) {
  const events = [];
  const highHeat = Number(higher?.usableWasteHeatKW ?? higher?.usableDataCenterHeatKW ?? 0);
  const lowHeat = Number(lower?.usableWasteHeatKW ?? lower?.usableDataCenterHeatKW ?? 0);
  if (lowHeat > highHeat + 1e-7) events.push({ type: "waste-heat", deltaKW: lowHeat - highHeat });
  const highMargins = branchMargins(higher), lowMargins = branchMargins(lower);
  for (const branch of lowMargins) {
    const prior = highMargins.find(item => item.id === branch.id);
    if (Number(branch.finalMargin) < 0 && Number(prior?.finalMargin) >= 0) events.push({ type: "branch-constraint", branchId: branch.id });
    if (Number(branch.requiredLift) > 0 && Number(prior?.requiredLift ?? 0) <= 0) events.push({ type: "booster-requirement", branchId: branch.id });
  }
  return events;
}

export function analyzeMarginalTemperature(points, currentTarget, stepK = 1, minimumTarget = 70, sweepPoints = points) {
  const validPoints = (points ?? []).filter(point => finite(point.hmpTargetTemp)).slice().sort((a, b) => Number(b.hmpTargetTemp) - Number(a.hmpTargetTemp));
  const current = validPoints.find(point => Math.abs(Number(point.hmpTargetTemp) - Number(currentTarget)) < 1e-7);
  const lowerTarget = Number(currentTarget) - Number(stepK);
  const lower = lowerTarget >= Number(minimumTarget) - 1e-8
    ? validPoints.find(point => Math.abs(Number(point.hmpTargetTemp) - lowerTarget) < 1e-7) ?? null
    : null;
  let local = null;
  if (current && lower) {
    const deltaK = Number(current.hmpTargetTemp) - Number(lower.hmpTargetTemp);
    const perK = difference => deltaK > 0 && finite(difference) ? difference / deltaK : 0;
    local = {
      current, lower, deltaK,
      additionalUsableHeatKWPerK: perK(Number(lower.usableWasteHeatKW ?? lower.usableDataCenterHeatKW ?? 0) - Number(current.usableWasteHeatKW ?? current.usableDataCenterHeatKW ?? 0)),
      centralProductionReductionKWPerK: perK(Number(current.centralPlantActualKW ?? 0) - Number(lower.centralPlantActualKW ?? 0)),
      additionalElectricityKWPerK: perK(Number(lower.totalSystemElectricKW ?? 0) - Number(current.totalSystemElectricKW ?? 0)),
      operatingBenefitPerHourPerK: perK(Number(current.operatingCostPerHour ?? 0) - Number(lower.operatingCostPerHour ?? 0)),
      gridboosterDutyChangeKWPerK: perK(Number(lower.installedBoosterThermalKW ?? 0) - Number(current.installedBoosterThermalKW ?? 0)),
      events: thresholdEvents(current, lower)
    };
  }
  const thresholds = [];
  for (let index = 0; index < validPoints.length - 1; index++) {
    const higher = validPoints[index], lowerPoint = validPoints[index + 1];
    if (Number(higher.hmpTargetTemp) >= Number(currentTarget) - 1e-8) continue;
    const events = thresholdEvents(higher, lowerPoint);
    if (events.length) thresholds.push({ temperatureC: Number(lowerPoint.hmpTargetTemp), events });
  }
  const bestCost = lowestSupportedPoint((sweepPoints ?? []).filter(point => finite(point.hmpTargetTemp)), "operatingCostPerHour");
  return {
    local,
    noChange: local != null && Math.abs(local.additionalUsableHeatKWPerK) < 1e-7,
    thresholds,
    bestCost: bestCost ? {
      hmpTargetTemp: Number(bestCost.hmpTargetTemp), operatingCostPerHour: Number(bestCost.operatingCostPerHour),
      usableWasteHeatKW: Number(bestCost.usableWasteHeatKW ?? bestCost.usableDataCenterHeatKW ?? 0), gridboosterElectricKW: Number(bestCost.installedBoosterElectricKW ?? 0),
      constrainedBranches: branchMargins(bestCost).filter(branch => Number(branch.finalMargin) < 0).length,
      boostedBranches: Number(bestCost.branchesRequiringBooster ?? 0)
    } : null
  };
}

export function calculateMarginalTemperature(input, sweepTargets, prices, currentTarget, minimumTarget = 70, existingPoints = []) {
  const baseTargets = [...new Set((sweepTargets ?? []).map(Number))];
  const targetSet = new Set(baseTargets);
  targetSet.add(Number(currentTarget));
  const step = sweepTargets?.length > 1 ? Math.abs(Number(sweepTargets[1]) - Number(sweepTargets[0])) : 1;
  const nextLower = Number(currentTarget) - step;
  if (nextLower >= minimumTarget) targetSet.add(nextLower);
  const missing = [...targetSet].filter(target => !baseTargets.some(existing => Math.abs(existing - target) < 1e-7));
  const points = [...existingPoints, ...calculateTemperatureFlexSweep(input, missing, prices)];
  return analyzeMarginalTemperature(points, currentTarget, step, minimumTarget, existingPoints);
}
