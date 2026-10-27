import {
  calculateNetworkState,
  calculateTemperatureFlexSweep,
  findPrimaryTemperatureBottleneck,
  isReturnSourceAvailableToConsumer,
  lowestSupportedPoint,
  summarizeNetworkFlexState
} from "./network-model.js?v=20261023-1";

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
  if (Number(industrial?.availableKW) > 0 && industrial.status === "TEMPERATURE BLOCKED") {
    const capability = number(industrial.contributionTemp);
    constraints.push({ type: "source-temperature", sourceId: "industrial-waste-heat", sourceName: "Industrial Waste Heat",
      capabilityTempC: capability, targetTempC: number(operating.hmpTargetTemp),
      shortfallK: capability == null ? null : Math.max(0, Number(operating.hmpTargetTemp) - capability) });
  }
  const wastewater = operating.wastewaterHeat;
  if (Number(wastewater?.availableKW) > 0 && wastewater.status === "TEMPERATURE BLOCKED") {
    const capability = number(wastewater.contributionTemp);
    constraints.push({ type: "source-temperature", sourceId: "wastewater-heat-recovery", sourceName: "Wastewater Heat Recovery",
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
  const sinks = operating.flexibleSinks;
  if (Number(sinks?.curtailedHeatKW) > 1e-8) constraints.push({ type: "demand-limited", surplusHeatKW: number(sinks.surplusHeatKW), curtailedHeatKW: number(sinks.curtailedHeatKW) });
  if (Number(sinks?.surplusHeatKW) > 1e-8 && input.flexibleSinks?.greenhouse?.enabled === false)
    constraints.push({ type: "greenhouse-opportunity", surplusHeatKW: number(sinks.surplusHeatKW) });
  if (Number(sinks?.absorptionCooling?.heatInputKW) <= 1e-8 && Number(sinks?.surplusHeatKW) > 1e-8)
    constraints.push({ type: sinks?.absorptionCooling?.temperatureEligible ? "absorption-cooling-opportunity" : "absorption-cooling-temperature", minimumTempC: number(sinks?.absorptionCooling?.minimumDrivingTempC) });

  const primary = constraints[0] ?? { type: "none" };
  return { primary, constraints, operating, returnNetwork: result.returnNetwork };
}

export function selectCasualSystemGuidance(beforeResult, currentResult, beforeMetrics, currentMetrics, constraints = []) {
  const before = beforeResult?.withBooster ?? {};
  const current = currentResult?.withBooster ?? {};
  const value = input => finite(input) ? Number(input) : 0;
  const heatUsed = metrics => value(metrics?.usableWasteHeatKW)
    + Math.max(0, value(metrics?.flexibleSinkHeatKW) - value(metrics?.flexibleSinks?.greenhouse?.supplyHeatKW)
      - value(metrics?.flexibleSinks?.absorptionCooling?.heatInputKW));
  const heatChangeKW = heatUsed(currentMetrics) - heatUsed(beforeMetrics);
  const flexibleChangeKW = value(currentMetrics?.flexibleSinkHeatKW) - value(beforeMetrics?.flexibleSinkHeatKW);
  const centralReductionKW = value(before.centralPlantUsedKW) - value(current.centralPlantUsedKW);
  const costBenefitPerHour = value(beforeMetrics?.operatingCostPerHour) - value(currentMetrics?.operatingCostPerHour);
  const curtailedReductionKW = value(before.flexibleSinks?.curtailedHeatKW) - value(current.flexibleSinks?.curtailedHeatKW);
  const hmpReductionC = value(before.hmpTargetTemp) - value(current.hmpTargetTemp);
  const feasibleCount = operating => (operating.afterBranches ?? []).filter(branch => branch.finalMargin != null
    && Number.isFinite(Number(branch.finalMargin)) && Number(branch.finalMargin) >= -1e-8).length;
  const feasibleBranchChange = feasibleCount(current) - feasibleCount(before);
  const usedSources = (result, metrics) => {
    const sources = new Map([
      ["data-center", value(metrics?.dataCenterInjectedHeatKW) + value(metrics?.dataCenterFlexibleHeatUsedKW)],
      ["industrial", value(metrics?.industrialWasteHeatUsedKW) + value(metrics?.industrialFlexibleHeatUsedKW)],
      ["wastewater", value(metrics?.wastewaterHeatUsedKW) + value(metrics?.wastewaterFlexibleHeatUsedKW)]
    ]);
    for (const source of result?.returnNetwork?.sources ?? []) {
      const key = source.id === "DC-RETURN" ? "data-center" : source.id === "SM-1" ? "supermarket" : source.id;
      sources.set(key, Math.max(sources.get(key) ?? 0, value(source.dispatchedKW)));
    }
    return new Set([...sources].filter(([, usedKW]) => usedKW > 5).map(([id]) => id));
  };
  const beforeSources = usedSources(beforeResult, beforeMetrics);
  const currentSources = usedSources(currentResult, currentMetrics);
  const newSourceCount = [...currentSources].filter(id => !beforeSources.has(id)).length;
  const improved = heatChangeKW > 5 || flexibleChangeKW > 5 || centralReductionKW > 5 || newSourceCount > 0
    || costBenefitPerHour > 0.005 || curtailedReductionKW > 5 || feasibleBranchChange > 0
    || hmpReductionC >= 0.25;
  const worsened = heatChangeKW < -5 || centralReductionKW < -5 || costBenefitPerHour < -0.005
    || curtailedReductionKW < -5 || feasibleBranchChange < 0;

  let resultKey = "casual.result.no_change";
  let resultArgs = {};
  if (heatChangeKW < -5 && costBenefitPerHour < -0.005) {
    resultKey = "casual.result.worse_both";
    resultArgs = { heat: (Math.abs(heatChangeKW) / 1000).toFixed(2), cost: Math.abs(costBenefitPerHour).toFixed(2) };
  } else if (heatChangeKW > 5) {
    resultKey = costBenefitPerHour > 0.005 ? "casual.result.heat_cost_down"
      : costBenefitPerHour < -0.005 ? "casual.result.heat_cost_up" : "casual.result.heat";
    resultArgs = { heat: (heatChangeKW / 1000).toFixed(2), cost: (Math.abs(costBenefitPerHour)).toFixed(2) };
  } else if (flexibleChangeKW > 5) {
    resultKey = "casual.result.flexible"; resultArgs = { heat: (flexibleChangeKW / 1000).toFixed(2) };
  } else if (centralReductionKW > 5) {
    resultKey = costBenefitPerHour < -0.005 ? "casual.result.central_cost_up" : "casual.result.central";
    resultArgs = { heat: (centralReductionKW / 1000).toFixed(2), cost: Math.abs(costBenefitPerHour).toFixed(2) };
  } else if (feasibleBranchChange > 0) {
    resultKey = costBenefitPerHour < -0.005 ? "casual.result.branches_cost_up" : "casual.result.branches";
    resultArgs = { branches: feasibleBranchChange, cost: Math.abs(costBenefitPerHour).toFixed(2) };
  } else if (curtailedReductionKW > 5) {
    resultKey = "casual.result.curtailment"; resultArgs = { heat: (curtailedReductionKW / 1000).toFixed(2) };
  } else if (hmpReductionC >= 0.25 && improved) {
    resultKey = "casual.result.cooler"; resultArgs = { temperature: hmpReductionC.toFixed(1) };
  } else if (newSourceCount > 0) {
    resultKey = "casual.result.sources"; resultArgs = { sources: newSourceCount };
  } else if (!improved && worsened) {
    resultKey = heatChangeKW < -5 && costBenefitPerHour < -0.005 ? "casual.result.worse_both"
      : costBenefitPerHour < -0.005 ? "casual.result.worse_cost"
        : heatChangeKW < -5 ? "casual.result.worse_heat"
          : centralReductionKW < -5 ? "casual.result.central_up"
            : curtailedReductionKW < -5 ? "casual.result.curtailment_up" : "casual.result.branches_down";
    resultArgs = { heat: (Math.abs(centralReductionKW < -5 ? centralReductionKW : curtailedReductionKW < -5 ? curtailedReductionKW : heatChangeKW) / 1000).toFixed(2),
      cost: Math.abs(costBenefitPerHour).toFixed(2), branches: Math.abs(feasibleBranchChange) };
  }

  const branchLimit = constraints.find(item => item.type === "branch-temperature");
  const sourceLimit = constraints.find(item => item.type === "source-temperature");
  const flexibleLimit = constraints.find(item => ["demand-limited", "greenhouse-opportunity", "absorption-cooling-opportunity", "absorption-cooling-temperature"].includes(item.type));
  const capacityLimit = constraints.find(item => item.type === "source-capacity");
  const topologyLimit = constraints.find(item => item.type === "return-topology");
  let nextKey = "casual.next.complete";
  let nextArgs = {};
  if (branchLimit) {
    nextArgs.branch = branchLimit.branchId;
    const branch = current.afterBranches?.find(item => item.id === branchLimit.branchId);
    const boosterElsewhere = (current.afterBranches ?? []).some(item => item.id !== branchLimit.branchId && item.gridBoosters?.length);
    nextKey = branch?.gridBoosters?.length || boosterElsewhere ? "casual.next.branch_move" : "casual.next.branch_boost";
  } else if (sourceLimit) nextKey = "casual.next.source";
  else if (flexibleLimit) nextKey = "casual.next.flexible";
  else if (capacityLimit) nextKey = "casual.next.capacity";
  else if (topologyLimit) nextKey = "casual.next.return";
  else if (!improved && worsened) nextKey = "casual.next.review";

  return { resultKey, resultArgs, nextKey, nextArgs, heatChangeKW, costBenefitPerHour, newSourceCount };
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
  ["prices.wastewaterHeatCostPerMWh", "wastewaterHeatPrice"],
  ["prices.coolingPricePerMWh", "coolingPrice"],
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
  ["input.wastewaterHeat", "wastewaterSource"],
  ["input.flexibleSinks", "flexibleHeatSinks"],
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
    dataCenterSupplyHeatKW: Number(operating.dataCenterHeatUsedKW ?? 0) + Number(operating.wasteHeat.flexibleDeliveredHeatKW ?? 0),
    industrialSupplyHeatKW: Number(operating.industrialWasteHeatUsedKW ?? 0) + Number(operating.industrialWasteHeat.flexibleUsedKW ?? 0),
    wastewaterSupplyHeatKW: Number(operating.wastewaterHeatUsedKW ?? 0) + Number(operating.wastewaterHeat.flexibleUsedKW ?? 0),
    greenhouseHeatKW: number(operating.flexibleSinks?.greenhouse.totalHeatKW) ?? 0,
    absorptionHeatInputKW: number(operating.flexibleSinks?.absorptionCooling.heatInputKW) ?? 0,
    coolingOutputKW: number(operating.flexibleSinks?.absorptionCooling.coolingOutputKW) ?? 0,
    surplusHeatKW: number(operating.flexibleSinks?.surplusHeatKW) ?? 0,
    curtailedHeatKW: number(operating.flexibleSinks?.curtailedHeatKW) ?? 0,
    usableWasteHeatKW: metrics.usableWasteHeatKW,
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
