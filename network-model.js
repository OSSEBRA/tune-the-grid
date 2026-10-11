export const WATER_DENSITY = 1000;
export const WATER_CP = 4.186;
export const KW_PER_M3H_K = WATER_DENSITY * WATER_CP / 3600;
export const CLOSE_MARGIN_K = 2;
export const BRANCH_IDS = ["A", "B", "C", "D", "E", "F"];

export function isReturnSourceAvailableToConsumer(source, consumer) {
  return Boolean(source?.enabled !== false && consumer?.enabled !== false
    && source?.type === "WASTE_HEAT_SOURCE" && consumer?.type === "THREE_PIPE_CONSUMER"
    && Number(source.order) < Number(consumer.order));
}

export function calculateThreePipeExtraction(consumer, availableKW) {
  const demandKW = consumer.enabled === false ? 0 : Math.max(0, Number(consumer.demandKW) || 0);
  const maxUptakeKW = Math.max(0, Number(consumer.maxUptakeKW ?? Infinity));
  const allocatedKW = Math.min(demandKW, maxUptakeKW, Math.max(0, Number(availableKW) || 0));
  return { demandKW, allocatedKW, unservedKW: demandKW - allocatedKW };
}

export function calculatePip3HeatSplit(demandKW, returnHeatKW) {
  const totalDemandKW = Math.max(0, Number(demandKW) || 0);
  const returnContributionKW = Math.min(totalDemandKW, Math.max(0, Number(returnHeatKW) || 0));
  return { demandKW: totalDemandKW, returnHeatKW: returnContributionKW, supplyTopUpKW: totalDemandKW - returnContributionKW };
}

export function calculateReturnNodeTemperature(inletTemp, thermalPowerKW, returnFlowM3h) {
  const flow = Number(returnFlowM3h);
  if (!(flow > 0)) return Number(inletTemp);
  return Number(inletTemp) + Number(thermalPowerKW) / (KW_PER_M3H_K * flow);
}

export function calculateReturnHeatDispatch(returnNetwork) {
  const network = returnNetwork ?? {};
  const nodes = (network.nodes ?? []).map(node => ({ ...node, order: Number(node.order) }))
    .sort((a, b) => a.order - b.order || String(a.id).localeCompare(String(b.id)));
  const sources = nodes.filter(node => node.type === "WASTE_HEAT_SOURCE").map(source => ({
    ...source, availableKW: source.enabled === false ? 0 : Math.max(0, Number(source.availableKW ?? Number(source.maxPowerMW ?? 0) * 1000) || 0),
    maxInjectionKW: Math.max(0, Number(source.maxInjectionKW ?? Infinity)),
    remainingKW: source.enabled === false ? 0 : Math.min(Math.max(0, Number(source.availableKW ?? Number(source.maxPowerMW ?? 0) * 1000) || 0), Math.max(0, Number(source.maxInjectionKW ?? Infinity))),
    dispatchedKW: 0
  }));
  const consumers = nodes.filter(node => node.type === "THREE_PIPE_CONSUMER").map(consumer => ({
    ...consumer, demandKW: consumer.enabled === false ? 0 : Math.max(0, Number(consumer.demandKW) || 0), allocatedKW: 0,
    unservedKW: consumer.enabled === false ? 0 : Math.max(0, Number(consumer.demandKW) || 0), allocations: []
  }));

  for (const consumer of consumers) {
    if (consumer.enabled === false) continue;
    const eligible = sources.filter(source => isReturnSourceAvailableToConsumer(source, consumer)
      && Number(source.sourceTempC) >= Number(consumer.minimumUsableTempC))
      .sort((a, b) => b.order - a.order || String(a.id).localeCompare(String(b.id)));
    let capacity = calculateThreePipeExtraction(consumer, eligible.reduce((sum, source) => sum + source.remainingKW, 0)).allocatedKW;
    for (const source of eligible) {
      const allocatedKW = Math.min(capacity, source.remainingKW);
      if (allocatedKW > 0) {
        source.remainingKW -= allocatedKW;
        source.dispatchedKW += allocatedKW;
        consumer.allocatedKW += allocatedKW;
        consumer.allocations.push({ sourceId: source.id, allocatedKW });
        capacity -= allocatedKW;
      }
      if (capacity <= 0) break;
    }
    consumer.unservedKW = consumer.demandKW - consumer.allocatedKW;
    const upstream = sources.filter(source => isReturnSourceAvailableToConsumer(source, consumer));
    const tempEligible = upstream.filter(source => Number(source.sourceTempC) >= Number(consumer.minimumUsableTempC));
    consumer.status = consumer.allocatedKW >= consumer.demandKW && consumer.demandKW > 0 ? "FULLY SUPPLIED"
      : consumer.allocatedKW > 0 ? "PARTIALLY SUPPLIED"
      : upstream.length === 0 ? "NO UPSTREAM SOURCE"
      : tempEligible.length === 0 ? "TEMPERATURE TOO LOW" : "NO RETURN HEAT AVAILABLE";
  }

  return { nodes, sources, consumers };
}

export function calculateReturnNetworkState(returnNetwork) {
  const network = returnNetwork ?? { baseReturnTempC: 45, returnFlowM3h: 500, nodes: [] };
  const { nodes, sources, consumers } = calculateReturnHeatDispatch(network);
  const sourceById = new Map(sources.map(source => [source.id, source]));
  const consumerById = new Map(consumers.map(consumer => [consumer.id, consumer]));
  const flow = Math.max(0, Number(network.returnFlowM3h) || 0);
  let temperature = Number(network.baseReturnTempC ?? 45);
  const temperatureNodes = nodes.map(node => {
    const inletTempC = temperature;
    let thermalPowerKW = 0;
    if (node.type === "WASTE_HEAT_SOURCE") thermalPowerKW = sourceById.get(node.id)?.dispatchedKW ?? 0;
    if (node.type === "THREE_PIPE_CONSUMER") thermalPowerKW = -(consumerById.get(node.id)?.allocatedKW ?? 0);
    temperature = calculateReturnNodeTemperature(temperature, thermalPowerKW, node.returnFlowM3h ?? flow);
    return { ...node, inletTempC, outletTempC: temperature, thermalPowerKW,
      ...(sourceById.has(node.id) ? sourceById.get(node.id) : {}),
      ...(consumerById.has(node.id) ? consumerById.get(node.id) : {}) };
  });
  const totalDemandKW = consumers.reduce((sum, consumer) => sum + consumer.demandKW, 0);
  const allocatedKW = consumers.reduce((sum, consumer) => sum + consumer.allocatedKW, 0);
  const totalAvailableKW = sources.reduce((sum, source) => sum + source.availableKW, 0);
  const dispatchedKW = sources.reduce((sum, source) => sum + source.dispatchedKW, 0);
  const eligibleAvailableKW = consumers.length ? sources.reduce((sum, source) => sum + (consumers.some(consumer =>
    isReturnSourceAvailableToConsumer(source, consumer) && Number(source.sourceTempC) >= Number(consumer.minimumUsableTempC)) ? source.availableKW : 0), 0) : 0;
  return { nodes: temperatureNodes, sources, consumers, totalDemandKW, eligibleAvailableKW, allocatedKW,
    unservedKW: totalDemandKW - allocatedKW, unusedSourceKW: totalAvailableKW - dispatchedKW,
    returnTempBeforeRecoveryC: temperatureNodes.find(node => node.type === "THREE_PIPE_CONSUMER")?.inletTempC ?? Number(network.baseReturnTempC ?? 45), returnTempAtPlantC: temperature,
    coolingBenefitK: allocatedKW / (KW_PER_M3H_K * flow || Infinity),
    returnFlowM3h: flow, dispatchRule: "Consumers in return-flow order; nearest upstream eligible source first." };
}

export function calculateBranchReturnDiagnostic(branch, branchSupplyTemp) {
  if (branch.returnTemp == null || branch.returnTemp === "" || !Number.isFinite(Number(branchSupplyTemp))) return null;
  const impliedHeatKW = Number(branch.flowM3h) * KW_PER_M3H_K * (Number(branchSupplyTemp) - Number(branch.returnTemp));
  const demandKW = Number(branch.demandKW);
  const differencePercent = demandKW > 0 ? (impliedHeatKW - demandKW) / demandKW * 100 : null;
  const mismatch = Math.abs(differencePercent ?? 0);
  return { impliedHeatKW, differencePercent,
    status: demandKW <= 0 ? Math.abs(impliedHeatKW) < 1e-9 ? "CONSISTENT" : "CHECK INPUTS"
      : mismatch <= 10 ? "CONSISTENT" : mismatch <= 25 ? "CHECK INPUTS" : "LARGE MISMATCH" };
}

export function calculateBranch(branch, hmpTemperatureCapabilityTemp, gridBoosters = []) {
  const flowM3h = Number(branch.flowM3h);
  const minimumSupplyTemp = Number(branch.minimumSupplyTemp);
  const hmpToBranchLoss = Number(branch.lossToBranch);
  const availableSupplyTemp = Number.isFinite(hmpTemperatureCapabilityTemp) ? hmpTemperatureCapabilityTemp - hmpToBranchLoss : null;
  const margin = availableSupplyTemp == null ? null : availableSupplyTemp - minimumSupplyTemp;
  const requiredLift = margin == null ? null : Math.max(0, -margin);
  let supplyTemp = availableSupplyTemp;
  const appliedBoosters = gridBoosters.map(gridBooster => {
    const canRun = supplyTemp != null && flowM3h > 0;
    const liftRequested = !canRun ? 0 : gridBooster.mode === "target"
      ? Math.max(0, Number(gridBooster.targetTemp) - supplyTemp)
      : Number(gridBooster.liftK);
    const requestedPowerKW = canRun ? flowM3h * KW_PER_M3H_K * liftRequested : 0;
    const thermalPowerKW = Math.min(requestedPowerKW, Number(gridBooster.maxThermalKW));
    const actualLiftK = canRun ? thermalPowerKW / (flowM3h * KW_PER_M3H_K) : 0;
    const electricalPowerKW = thermalPowerKW / Number(gridBooster.cop);
    const inletTemp = supplyTemp;
    if (supplyTemp != null) supplyTemp += actualLiftK;
    return { ...gridBooster, inletTemp, outletTemp: supplyTemp, liftRequested, actualLiftK, requestedPowerKW,
      thermalPowerKW, electricalPowerKW, capacitySufficient: requestedPowerKW <= Number(gridBooster.maxThermalKW) && (!liftRequested || flowM3h > 0) };
  });
  const finalMargin = supplyTemp == null ? null : supplyTemp - minimumSupplyTemp;
  const boosterThermalPowerKW = appliedBoosters.reduce((sum, item) => sum + item.thermalPowerKW, 0);
  const boosterElectricalPowerKW = appliedBoosters.reduce((sum, item) => sum + item.electricalPowerKW, 0);
  const boosterLiftK = appliedBoosters.reduce((sum, item) => sum + item.actualLiftK, 0);
  const boosterActive = appliedBoosters.some(item => item.actualLiftK > 0);
  const status = margin == null ? "unavailable" : margin < 0 ? "below" : margin <= CLOSE_MARGIN_K ? "close" : "feasible";
  const finalStatus = finalMargin == null ? "unavailable" : boosterActive
    ? finalMargin >= 0 ? "boosted" : "boosted-below"
    : finalMargin < 0 ? "below" : finalMargin <= CLOSE_MARGIN_K ? "close" : "feasible";
  return {
    ...branch,
    name: String(branch.name ?? branch.id),
    demandKW: Number(branch.demandKW),
    minimumSupplyTemp,
    flowM3h,
    lossToBranch: hmpToBranchLoss,
    availableSupplyTemp,
    margin,
    feasibleWithoutBooster: margin != null && margin >= 0,
    requiredLift,
    requiredBoosterPowerKW: requiredLift == null ? null : flowM3h * KW_PER_M3H_K * requiredLift,
    status,
    finalSupplyTemp: supplyTemp,
    finalMargin,
    finalStatus,
    boosterActive,
    gridBoosters: appliedBoosters,
    boosterLiftK,
    boosterThermalPowerKW,
    boosterElectricalPowerKW
  };
}

export function findPrimaryTemperatureBottleneck(branches = []) {
  return branches
    .filter(branch => Number.isFinite(Number(branch.finalMargin)) && Number(branch.finalMargin) < 0)
    .sort((a, b) => Number(a.finalMargin) - Number(b.finalMargin) || String(a.id).localeCompare(String(b.id)))[0] ?? null;
}

export function calculateWasteHeat(source, hmpTargetTemp, lossToHMP = 0) {
  const availableKW = Number(source.maxPowerMW) * 1000 * Number(source.availabilityPercent) / 100;
  const outletTemp = Number(source.injectionTemp);
  const contributionTemp = outletTemp - Number(lossToHMP);
  const directInjectionEligible = false;
  return { injectionTemp: outletTemp, contributionTemp, lossToHMP: Number(lossToHMP), availableKW,
    directInjectionEligible, usableKW: directInjectionEligible ? availableKW : 0 };
}

export function calculateCentralPlant(source, hmpTargetTemp, lossToHMP = 0) {
  const availableKW = Number(source.maxPowerMW) * 1000 * Number(source.availabilityPercent) / 100;
  const supplyTemp = Number(source.supplyTemp);
  const contributionTemp = supplyTemp - Number(lossToHMP);
  const temperatureEligible = contributionTemp >= Number(hmpTargetTemp);
  return { supplyTemp, contributionTemp, lossToHMP: Number(lossToHMP), availableKW,
    temperatureEligible, usableKW: temperatureEligible ? availableKW : 0 };
}

function heatPumpStep(sourceHeatKW, inletTemp, outletTargetTemp, cop) {
  const liftActive = Number(outletTargetTemp) > Number(inletTemp);
  const electricalPowerKW = liftActive ? sourceHeatKW / (Number(cop) - 1) : 0;
  return { inletTemp: Number(inletTemp), requestedOutletTemp: Number(outletTargetTemp),
    outletTemp: liftActive ? Number(outletTargetTemp) : Number(inletTemp), sourceHeatKW, electricalPowerKW,
    deliveredHeatKW: sourceHeatKW + electricalPowerKW, noUpgradeRequired: !liftActive };
}

export function calculateDataCenterModes(source, hmpTargetTemp, totalDemandKW = Infinity, lossToHMP = 0) {
  const selectedMode = source.mode ?? null;
  const sourceHeatKW = Number(source.maxPowerMW) * 1000 * Number(source.availabilityPercent) / 100;
  const rawTemp = Number(source.injectionTemp);
  const rawReturn = { mode: "raw-return", sourceHeatKW, electricalPowerKW: 0, deliveredHeatKW: 0,
    outletTemp: rawTemp, totalCOP: null, stages: [] };
  const oneStageAvailable = rawTemp <= 70;
  const oneStageTarget = oneStageAvailable ? Math.min(75, Math.max(rawTemp + 5, Number(source.singleStageOutletTemp))) : null;
  const oneStage = oneStageAvailable
    ? heatPumpStep(sourceHeatKW, rawTemp, oneStageTarget, source.singleStageCOP)
    : { outletTemp: null, electricalPowerKW: 0, deliveredHeatKW: 0, noUpgradeRequired: false, stages: [] };
  const one = { mode: "one-stage", sourceHeatKW, electricalPowerKW: oneStage.electricalPowerKW,
    deliveredHeatKW: oneStage.deliveredHeatKW, outletTemp: oneStage.outletTemp,
    totalCOP: oneStage.electricalPowerKW > 0 ? oneStage.deliveredHeatKW / oneStage.electricalPowerKW : null,
    noUpgradeRequired: oneStage.noUpgradeRequired, temperatureRangeAvailable: oneStageAvailable,
    requestedOutletTemp: Number(source.singleStageOutletTemp), stages: oneStageAvailable ? [oneStage] : [] };
  const twoStageAvailable = rawTemp <= 85;
  const stage1Target = Math.min(75, Number(source.stage1OutletTemp));
  const stage1 = heatPumpStep(sourceHeatKW, rawTemp, stage1Target, source.stage1COP);
  const stage2 = twoStageAvailable
    ? heatPumpStep(stage1.deliveredHeatKW, stage1.outletTemp, Math.min(85, Math.max(75, Number(source.stage2OutletTemp))), source.stage2COP)
    : { outletTemp: null, electricalPowerKW: 0, deliveredHeatKW: 0, noUpgradeRequired: false };
  const twoStageElectricKW = stage1.electricalPowerKW + stage2.electricalPowerKW;
  const two = { mode: "two-stage", sourceHeatKW, electricalPowerKW: twoStageElectricKW,
    deliveredHeatKW: stage2.deliveredHeatKW, outletTemp: stage2.outletTemp,
    totalCOP: twoStageElectricKW > 0 ? stage2.deliveredHeatKW / twoStageElectricKW : null,
    noUpgradeRequired: twoStageElectricKW === 0, temperatureRangeAvailable: twoStageAvailable,
    requestedOutletTemp: Number(source.stage2OutletTemp), stages: twoStageAvailable ? [stage1, stage2] : [] };
  const results = { "raw-return": rawReturn, "one-stage": one, "two-stage": two };
  for (const result of Object.values(results)) {
    result.availableKW = result.mode === "raw-return" ? 0 : sourceHeatKW;
    result.lossToHMP = Number(lossToHMP);
    result.contributionTemp = result.outletTemp == null ? null : result.outletTemp - Number(lossToHMP);
    result.active = result.mode === selectedMode;
    result.injectionEligible = result.mode !== "raw-return" && result.contributionTemp != null && result.contributionTemp > Number(hmpTargetTemp);
    result.strictTemperatureEligible = result.injectionEligible;
    result.usedViaBlending = false;
    result.usableKW = result.injectionEligible ? result.deliveredHeatKW : 0;
    result.injectedKW = result.active ? Math.min(Number(totalDemandKW), result.usableKW) : 0;
    result.usedInSelectedDispatch = result.active && result.injectionEligible && result.injectedKW > 0;
  }
  return results;
}

function validateNetwork(input) {
  const errors = [];
  if (input.networkReturnTemp === "" || input.networkReturnTemp != null && !Number.isFinite(Number(input.networkReturnTemp))) errors.push("Network return temperature must be a number.");
  if (input.sourceTemperatureStrategy != null && !["strict", "blended"].includes(input.sourceTemperatureStrategy)) errors.push("Select strict or blended source temperature strategy.");
  if (input.referenceNetworkDeltaK != null && input.referenceNetworkDeltaK !== "" && (!Number.isFinite(Number(input.referenceNetworkDeltaK)) || Number(input.referenceNetworkDeltaK) <= 0)) errors.push("Reference network ΔT must be a positive number.");
  const finite = ["hmpTargetTemp", "outdoorTemp", "centralPlant.supplyTemp", "centralPlant.maxPowerMW", "centralPlant.availabilityPercent", "centralPlant.lossToHMP", "wasteHeat.injectionTemp", "wasteHeat.maxPowerMW", "wasteHeat.availabilityPercent", "wasteHeat.lossToHMP", "wasteHeat.singleStageOutletTemp", "wasteHeat.singleStageCOP", "wasteHeat.stage1OutletTemp", "wasteHeat.stage1COP", "wasteHeat.stage2OutletTemp", "wasteHeat.stage2COP", "booster.cop", "booster.maxThermalKW"];
  for (const path of finite) {
    const value = path.split(".").reduce((object, key) => object?.[key], input);
    if (value === "" || !Number.isFinite(Number(value))) errors.push(`${path} must be a number.`);
  }
  if (!Array.isArray(input.branches) || input.branches.length !== 6 || input.branches.map(branch => branch.id).sort().join("") !== "ABCDEF")
    errors.push("The network must contain branches A, B, C, D, E and F exactly once.");
  for (const branch of input.branches ?? []) {
    for (const key of ["demandKW", "minimumSupplyTemp", "flowM3h", "lossToBranch"])
      if (branch[key] === "" || !Number.isFinite(Number(branch[key]))) errors.push(`Branch ${branch.id} ${key} must be a number.`);
    if (Number(branch.demandKW) < 0) errors.push(`Branch ${branch.id} heat demand cannot be negative.`);
    if (Number(branch.flowM3h) < 0) errors.push(`Branch ${branch.id} flow cannot be negative.`);
    if (Number(branch.lossToBranch) < 0) errors.push(`Branch ${branch.id} temperature loss cannot be negative.`);
    if (branch.returnTemp != null && branch.returnTemp !== "" && !Number.isFinite(Number(branch.returnTemp))) errors.push(`Branch ${branch.id} return temperature must be a number.`);
    if (!String(branch.name ?? "").trim()) errors.push(`Branch ${branch.id} name cannot be empty.`);
  }
  if (Number(input.centralPlant?.maxPowerMW) < 0) errors.push("Central plant maximum power cannot be negative.");
  if (Number(input.centralPlant?.availabilityPercent) < 0 || Number(input.centralPlant?.availabilityPercent) > 100) errors.push("Central plant availability must be between 0 and 100%.");
  if (Number(input.centralPlant?.lossToHMP) < 0) errors.push("Plant-to-HMP temperature loss cannot be negative.");
  if (Number(input.wasteHeat.maxPowerMW) < 0) errors.push("Waste-heat maximum power cannot be negative.");
  if (Number(input.wasteHeat.availabilityPercent) < 0 || Number(input.wasteHeat.availabilityPercent) > 100) errors.push("Waste-heat availability must be between 0 and 100%.");
  if (Number(input.wasteHeat.lossToHMP) < 0) errors.push("Data-center-to-HMP temperature loss cannot be negative.");
  if (input.sourceTemperatureStrategy === "blended") {
    for (const [key, label] of [["normalPlantSupplyTemp", "Normal plant supply temperature"], ["maxRampedPlantSupplyTemp", "Maximum ramped plant supply temperature"], ["plantRampCostPerMWhPerK", "Plant temperature ramp cost"]])
      if (input[key] === "" || !Number.isFinite(Number(input[key]))) errors.push(`${label} must be a number.`);
    if (Number(input.normalPlantSupplyTemp) < 0 || Number(input.maxRampedPlantSupplyTemp) < Number(input.normalPlantSupplyTemp)) errors.push("Maximum ramped plant supply must be at least the normal plant supply temperature.");
    if (Number(input.plantRampCostPerMWhPerK) < 0) errors.push("Plant temperature ramp cost cannot be negative.");
    const returnTemp = Number(input.networkReturnTemp ?? 40);
    const selectedDC = calculateDataCenterModes(input.wasteHeat, input.hmpTargetTemp, Infinity, input.wasteHeat.lossToHMP)[input.wasteHeat.mode];
    if (returnTemp >= Number(input.maxRampedPlantSupplyTemp) - Number(input.centralPlant.lossToHMP)
      || Number(input.wasteHeat.maxPowerMW) * Number(input.wasteHeat.availabilityPercent) > 0 && returnTemp >= selectedDC.contributionTemp)
      errors.push("Blended source mixing requires the common network return temperature to be below each contributing source temperature.");
  }
  if (!["raw-return", "one-stage", "two-stage"].includes(input.wasteHeat.mode)) errors.push("Select raw return, one-stage supply or two-stage supply data-center operation.");
  const rawSourceTemp = Number(input.wasteHeat.injectionTemp);
  if (input.wasteHeat.mode === "one-stage") {
    if (rawSourceTemp + 5 > 75) errors.push("One-stage HP is unavailable: RAW + 5 K exceeds the 75°C outlet maximum.");
    else if (Number(input.wasteHeat.singleStageOutletTemp) < rawSourceTemp + 5 || Number(input.wasteHeat.singleStageOutletTemp) > 75)
      errors.push(`One-stage outlet must be between RAW + 5 K (${rawSourceTemp + 5}°C) and 75°C.`);
  }
  if (input.wasteHeat.mode === "two-stage") {
    if (rawSourceTemp > 85) errors.push("Two-stage HP is unavailable when the raw source exceeds its 85°C outlet maximum.");
    if (Number(input.wasteHeat.stage1OutletTemp) > 75) errors.push("Two-stage Stage 1 outlet must not exceed 75°C.");
    if (Number(input.wasteHeat.stage2OutletTemp) < 75 || Number(input.wasteHeat.stage2OutletTemp) > 85)
      errors.push("Two-stage final outlet must be between 75°C and 85°C.");
  }
  for (const key of ["singleStageCOP", "stage1COP", "stage2COP"])
    if (Number(input.wasteHeat[key]) <= 1) errors.push(`Data-center ${key} must be greater than 1.`);
  if (Number(input.booster.cop) <= 1) errors.push("Gridbooster COP must be greater than 1.");
  if (Number(input.booster.maxThermalKW) < 0) errors.push("Gridbooster thermal capacity cannot be negative.");
  if (!BRANCH_IDS.includes(input.booster.branchId) && input.booster.branchId !== "none") errors.push("Select branch A–F or none for quick Gridbooster placement.");
  if (!Array.isArray(input.gridBoosters)) errors.push("Gridboosters must be a list.");
  const boosterIds = new Set();
  for (const item of input.gridBoosters ?? []) {
    if (boosterIds.has(String(item.id))) errors.push(`Gridbooster id ${item.id} is duplicated.`);
    boosterIds.add(String(item.id));
    if (item.branchId && !BRANCH_IDS.includes(item.branchId)) errors.push(`Gridbooster ${item.id} has an invalid branch.`);
    if (!["target", "lift"].includes(item.mode)) errors.push(`Gridbooster ${item.id} mode must be target or lift.`);
    for (const key of ["cop", "maxThermalKW", item.mode === "target" ? "targetTemp" : "liftK"])
      if (item[key] === "" || !Number.isFinite(Number(item[key]))) errors.push(`Gridbooster ${item.id} ${key} must be a number.`);
    if (Number(item.cop) <= 1) errors.push(`Gridbooster ${item.id} COP must be greater than 1.`);
    if (Number(item.maxThermalKW) < 0) errors.push(`Gridbooster ${item.id} capacity cannot be negative.`);
    if (item.mode === "lift" && Number(item.liftK) < 0) errors.push(`Gridbooster ${item.id} lift cannot be negative.`);
  }
  const templateValue = input.booster.mode === "target" ? input.booster.targetTemp : input.booster.liftK;
  if (!["target", "lift"].includes(input.booster.mode)) errors.push("Gridbooster template mode must be target or lift.");
  if (templateValue === "" || !Number.isFinite(Number(templateValue))) errors.push("Gridbooster template target or lift must be a number.");
  if (input.booster.mode === "lift" && Number(input.booster.liftK) < 0) errors.push("Gridbooster template lift cannot be negative.");
  return errors;
}

function simulate(input, installedBoosters, sourceOverride = null) {
  const totalDemandKW = input.branches.reduce((sum, branch) => sum + Number(branch.demandKW), 0);
  const centralPlant = sourceOverride?.centralPlant ?? calculateCentralPlant(input.centralPlant, input.hmpTargetTemp, input.centralPlant.lossToHMP);
  const dataCenterModes = calculateDataCenterModes(input.wasteHeat, input.hmpTargetTemp, totalDemandKW, input.wasteHeat.lossToHMP);
  const wasteHeat = sourceOverride?.wasteHeat ?? dataCenterModes[input.wasteHeat.mode];
  const plantCanContribute = centralPlant.availableKW > 0;
  const dcCanContribute = wasteHeat.availableKW > 0 && wasteHeat.injectionEligible;
  const sourceTemperatures = [];
  if (plantCanContribute) sourceTemperatures.push(centralPlant.contributionTemp);
  if (dcCanContribute) sourceTemperatures.push(wasteHeat.contributionTemp);
  const highestAvailableSourceTemp = sourceTemperatures.length ? Math.max(...sourceTemperatures) : null;
  // This is temperature capability at the HMP setpoint, not a mixed or achieved network temperature.
  // Mixing cannot be calculated without adequate flow and return-temperature data.
  const hmpTemperatureCapabilityTemp = sourceOverride?.mixedSupplyTemp ?? (highestAvailableSourceTemp == null ? null : Math.min(Number(input.hmpTargetTemp), highestAvailableSourceTemp));
  const networkReturnTemp = Number(input.networkReturnTemp ?? 40);
  const networkDeltaK = Number(input.hmpTargetTemp) - networkReturnTemp;
  const referenceNetworkDeltaK = input.referenceNetworkDeltaK == null || input.referenceNetworkDeltaK === "" ? null : Number(input.referenceNetworkDeltaK);
  const wasteHeatUsedKW = wasteHeat.injectedKW;
  const injectedFraction = wasteHeat.injectionEligible && wasteHeat.deliveredHeatKW > 0 ? wasteHeat.injectedKW / wasteHeat.deliveredHeatKW : 0;
  const dataCenterSourceHeatUsedKW = wasteHeat.sourceHeatKW * injectedFraction;
  const dataCenterElectricPowerKW = wasteHeat.electricalPowerKW * injectedFraction;
  const centralProductionKW = Math.max(0, totalDemandKW - wasteHeatUsedKW);
  const centralPlantUsedKW = Math.min(centralProductionKW, centralPlant.usableKW);
  const centralPlantShortfallKW = Math.max(0, centralProductionKW - centralPlantUsedKW);
  const hmpPowerAvailableKW = wasteHeat.usableKW + centralPlant.usableKW;
  const hmpPowerShortfallKW = Math.max(0, totalDemandKW - hmpPowerAvailableKW);
  const hmpTemperatureReachable = hmpTemperatureCapabilityTemp != null && hmpTemperatureCapabilityTemp >= Number(input.hmpTargetTemp);
  const networkOperatingPointSupported = hmpTemperatureReachable && hmpPowerShortfallKW <= 1e-9;
  const addReturnDiagnostic = branch => ({ ...branch,
    branchReturnDiagnostic: calculateBranchReturnDiagnostic(branch, branch.finalSupplyTemp),
    returnTemp: branch.returnTemp == null || branch.returnTemp === "" ? null : Number(branch.returnTemp),
    branchDeltaK: branch.returnTemp == null || branch.returnTemp === "" || branch.finalSupplyTemp == null ? null : branch.finalSupplyTemp - Number(branch.returnTemp)
  });
  const branches = input.branches.map(branch => addReturnDiagnostic(calculateBranch(branch, hmpTemperatureCapabilityTemp)));
  const afterBranches = input.branches.map(branch => addReturnDiagnostic(calculateBranch(branch, hmpTemperatureCapabilityTemp,
    installedBoosters.filter(item => item.branchId === branch.id))));
  const feasibleCount = branches.filter(branch => branch.feasibleWithoutBooster).length;
  const criticalCount = branches.filter(branch => branch.status === "below" || branch.status === "unavailable").length;
  const criticalAfterCount = afterBranches.filter(branch => branch.finalStatus === "below" || branch.finalStatus === "boosted-below" || branch.finalStatus === "unavailable").length;
  const allGridBoosters = afterBranches.flatMap(branch => branch.gridBoosters);
  const totalBoosterPowerKW = allGridBoosters.reduce((sum, item) => sum + item.thermalPowerKW, 0);
  const totalBoosterElectricKW = allGridBoosters.reduce((sum, item) => sum + item.electricalPowerKW, 0);
  const totalBoosterRequestedKW = allGridBoosters.reduce((sum, item) => sum + item.requestedPowerKW, 0);
  const criticalBeforeBranchCount = branches.filter(branch => branch.requiredLift > 0 || branch.status === "unavailable").length;
  return {
    hmpTargetTemp: Number(input.hmpTargetTemp), hmpTemperatureCapabilityTemp, hmpTemperatureReachable,
    networkReturnTemp, networkDeltaK, referenceNetworkDeltaK,
    networkOperatingPointSupported, hmpCapacitySufficient: hmpPowerShortfallKW <= 1e-9,
    hmpPowerAvailableKW, hmpPowerShortfallKW,
    outdoorTemp: Number(input.outdoorTemp), branches, afterBranches, totalDemandKW,
    feasibleCount, feasibleAfterCount: afterBranches.filter(branch => branch.finalMargin != null && branch.finalMargin >= 0).length,
    branchesNeedingBooster: criticalBeforeBranchCount, criticalCount, criticalAfterCount,
    closeCount: branches.filter(branch => branch.status === "close").length,
    centralPlant, centralPlantUsedKW, centralPlantShortfallKW,
    wasteHeat, dataCenterModes, wasteHeatUsedKW, dataCenterSourceHeatUsedKW, dataCenterElectricPowerKW, centralProductionKW,
    sourceBlending: sourceOverride?.diagnostics ?? null,
    plantRampPenaltyPerHour: sourceOverride?.diagnostics?.rampPenaltyPerHour ?? 0,
    booster: { branchId: input.booster.branchId, installedCount: installedBoosters.length,
      thermalPowerKW: totalBoosterPowerKW, electricalPowerKW: totalBoosterElectricKW,
      requestedPowerKW: totalBoosterRequestedKW, capacityKW: allGridBoosters.reduce((sum, item) => sum + Number(item.maxThermalKW), 0),
      capacitySufficient: allGridBoosters.every(item => item.capacitySufficient) }
  };
}

function estimatedSourceFlows(plantKW, plantAtHMP, dcKW, dcAtHMP, returnTemp) {
  const plantFlowM3h = plantKW === 0 ? 0 : plantKW / (KW_PER_M3H_K * (plantAtHMP - returnTemp));
  const dataCenterFlowM3h = dcKW === 0 ? 0 : dcKW / (KW_PER_M3H_K * (dcAtHMP - returnTemp));
  if (![plantFlowM3h, dataCenterFlowM3h].every(Number.isFinite) || plantFlowM3h < 0 || dataCenterFlowM3h < 0 || plantFlowM3h + dataCenterFlowM3h <= 0) return null;
  return { plantFlowM3h, dataCenterFlowM3h,
    mixedSupplyTemp: (plantFlowM3h * plantAtHMP + dataCenterFlowM3h * dcAtHMP) / (plantFlowM3h + dataCenterFlowM3h) };
}

export function calculateBlendedSourceState(input, strictState, installedBoosters, prices = {}) {
  const demandKW = strictState.totalDemandKW, dcPath = strictState.dataCenterModes[input.wasteHeat.mode];
  const normal = Number(input.normalPlantSupplyTemp), maximum = Number(input.maxRampedPlantSupplyTemp);
  const loss = Number(input.centralPlant.lossToHMP), target = Number(input.hmpTargetTemp), returnTemp = Number(input.networkReturnTemp ?? 40);
  const dcAtHMP = dcPath.contributionTemp;
  const maxDataCenterKW = Math.min(demandKW, dcPath.deliveredHeatKW);
  const strictCost = calculateOperatingCost({ centralPlantKW: strictState.centralPlantUsedKW,
    wasteHeatKW: strictState.dataCenterSourceHeatUsedKW,
    electricPowerKW: strictState.dataCenterElectricPowerKW + strictState.booster.electricalPowerKW }, prices);
  const strictFeasible = strictState.networkOperatingPointSupported;
  const baseDiagnostics = { strictFeasible, blendedFeasible: false, strictCostPerHour: strictCost,
    blendedCostPerHour: null, selectedDispatch: strictFeasible ? "strict" : null,
    selected: false, availableDataCenterHeatKW: maxDataCenterKW, selectedDataCenterHeatKW: 0,
    dataCenterSourceUtilizationPercent: 0 };
  if (dcPath.injectionEligible || maxDataCenterKW <= 0) return { dispatch: null, diagnostics: {
    ...baseDiagnostics, status: strictFeasible ? "STRICT OPERATION SELECTED" : "NO SOURCE-SIDE FEASIBLE DISPATCH",
    limitingStatus: strictFeasible ? null : "SOURCE CAPACITY SHORTFALL" } };

  let best = null, sawCapacityShortfall = false, sawRampLimit = false, feasibleCandidateCount = 0;
  // ponytail: 101 deterministic candidates bound dispatch resolution to 1% of available heat.
  for (let step = 0; step <= 100; step++) {
    const dataCenterKW = maxDataCenterKW * step / 100;
    const plantKW = Math.max(0, demandKW - dataCenterKW);
    if (plantKW > strictState.centralPlant.availableKW + 1e-9) { sawCapacityShortfall = true; continue; }
    const mixAt = supply => estimatedSourceFlows(plantKW, supply - loss, dataCenterKW, dcAtHMP, returnTemp);
    const maximumMix = mixAt(maximum);
    if (!maximumMix || maximumMix.mixedSupplyTemp < target) { sawRampLimit = true; continue; }
    let requiredPlantSupplyTemp = normal;
    if ((mixAt(normal)?.mixedSupplyTemp ?? -Infinity) < target) {
      let low = normal, high = maximum;
      for (let i = 0; i < 60; i++) {
        const mid = (low + high) / 2;
        if ((mixAt(mid)?.mixedSupplyTemp ?? -Infinity) >= target) high = mid; else low = mid;
      }
      requiredPlantSupplyTemp = high;
    }
    const mix = mixAt(requiredPlantSupplyTemp);
    if (!mix || mix.mixedSupplyTemp < target || requiredPlantSupplyTemp > maximum) { sawRampLimit = true; continue; }
    const rampK = Math.max(0, requiredPlantSupplyTemp - normal);
    const rampPenaltyPerHour = plantKW / 1000 * rampK * Number(input.plantRampCostPerMWhPerK ?? 0.5);
    const centralPlant = calculateCentralPlant({ ...input.centralPlant, supplyTemp: requiredPlantSupplyTemp }, target, loss);
    const wasteHeat = { ...dcPath, strictTemperatureEligible: dcPath.injectionEligible,
      injectionEligible: true, usableKW: dcPath.deliveredHeatKW, injectedKW: dataCenterKW,
      usedInSelectedDispatch: dataCenterKW > 0, usedViaBlending: dataCenterKW > 0 && !dcPath.injectionEligible };
    const candidate = simulate(input, installedBoosters, { centralPlant, wasteHeat, mixedSupplyTemp: mix.mixedSupplyTemp });
    const feasible = mix.mixedSupplyTemp >= target && candidate.hmpPowerShortfallKW <= 1e-9
      && candidate.centralPlantShortfallKW <= 1e-9;
    if (!feasible) { sawCapacityShortfall = true; continue; }
    feasibleCandidateCount++;
    const costPerHour = calculateOperatingCost({ centralPlantKW: candidate.centralPlantUsedKW,
      wasteHeatKW: candidate.dataCenterSourceHeatUsedKW,
      electricPowerKW: candidate.dataCenterElectricPowerKW + candidate.booster.electricalPowerKW }, prices) + rampPenaltyPerHour;
    if (!best || costPerHour < best.costPerHour) best = { candidate, centralPlant, wasteHeat, mix,
      dataCenterKW, plantKW, requiredPlantSupplyTemp, rampK, rampPenaltyPerHour, costPerHour };
  }

  const blendedFeasible = best != null;
  const chooseBlended = blendedFeasible && (!strictFeasible || best.costPerHour < strictCost - 1e-9);
  const selectedDispatch = chooseBlended ? "blended" : strictFeasible ? "strict" : null;
  const diagnostics = { ...baseDiagnostics, blendedFeasible,
    status: chooseBlended ? strictFeasible ? "BLENDED OPERATION SELECTED" : "BLENDED OPERATION REQUIRED FOR FEASIBILITY"
      : strictFeasible ? blendedFeasible ? "BLENDING NOT ECONOMIC" : "STRICT OPERATION SELECTED"
        : "NO SOURCE-SIDE FEASIBLE DISPATCH",
    limitingStatus: chooseBlended || strictFeasible ? null : sawCapacityShortfall ? "SOURCE CAPACITY SHORTFALL" : sawRampLimit ? "RAMP LIMIT EXCEEDED" : "NO SOURCE-SIDE FEASIBLE DISPATCH",
    candidateCount: 101, feasibleCandidateCount,
    selected: chooseBlended, selectedDispatch,
    blendedCostPerHour: best?.costPerHour ?? null,
    differencePerHour: best ? best.costPerHour - strictCost : null,
    availableDataCenterHeatKW: maxDataCenterKW,
    selectedDataCenterHeatKW: chooseBlended ? best.dataCenterKW : 0,
    dataCenterSourceUtilizationPercent: maxDataCenterKW > 0 && chooseBlended ? best.dataCenterKW / maxDataCenterKW * 100 : 0,
    ...(best ? { plantContributionTemp: best.requiredPlantSupplyTemp - loss, dataCenterContributionTemp: dcAtHMP,
      plantThermalKW: best.plantKW, dataCenterThermalKW: best.dataCenterKW,
      plantFlowM3h: best.mix.plantFlowM3h, dataCenterFlowM3h: best.mix.dataCenterFlowM3h,
      mixedSupplyTemp: best.mix.mixedSupplyTemp, hmpTargetTemp: target,
      requiredPlantSupplyTemp: best.requiredPlantSupplyTemp, normalPlantSupplyTemp: normal,
      plantRampK: best.rampK, rampLimitSupplyTemp: maximum, rampPenaltyPerHour: best.rampPenaltyPerHour } : {}) };
  return { dispatch: chooseBlended ? { centralPlant: best.centralPlant, wasteHeat: best.wasteHeat,
    mixedSupplyTemp: best.mix.mixedSupplyTemp, diagnostics } : null, diagnostics };
}

function routeDataCenterReturnSource(returnNetwork, wasteHeat) {
  if (!returnNetwork) return returnNetwork;
  const rawReturnSelected = wasteHeat.mode === "raw-return";
  const availableKW = Number(wasteHeat.maxPowerMW) * 1000 * Number(wasteHeat.availabilityPercent) / 100;
  let dataCenterNodeSeen = false;
  return { ...returnNetwork, nodes: (returnNetwork.nodes ?? []).flatMap(node => {
    if (node.id !== "DC-RETURN" && node.sourceGroupId !== "DATA-CENTER") return [node];
    if (dataCenterNodeSeen) return [];
    dataCenterNodeSeen = true;
    return [{ ...node, id: "DC-RETURN", sourceGroupId: "DATA-CENTER", enabled: rawReturnSelected,
      sourceTempC: Number(wasteHeat.injectionTemp), availableKW: rawReturnSelected ? availableKW : 0 }];
  }) };
}

export function calculateNetworkState(input, hmpTargetTemp = input.hmpTargetTemp, prices = {}) {
  const stateInput = { ...input, hmpTargetTemp: Number(hmpTargetTemp),
    returnNetwork: routeDataCenterReturnSource(input.returnNetwork, input.wasteHeat) };
  const errors = validateNetwork(stateInput);
  if (errors.length) throw new Error(errors.join(" "));
  const baselineInput = stateInput.sourceTemperatureStrategy === "blended"
    ? { ...stateInput, centralPlant: { ...stateInput.centralPlant, supplyTemp: Number(stateInput.normalPlantSupplyTemp) } }
    : stateInput;
  let without = simulate(baselineInput, []), withBooster = simulate(baselineInput, baselineInput.gridBoosters);
  if (stateInput.sourceTemperatureStrategy === "blended") {
    const blendWithout = calculateBlendedSourceState(stateInput, without, [], prices);
    const blendWith = calculateBlendedSourceState(stateInput, withBooster, stateInput.gridBoosters, prices);
    without = blendWithout.dispatch ? simulate(stateInput, [], blendWithout.dispatch) : { ...without, sourceBlending: blendWithout.diagnostics };
    withBooster = blendWith.dispatch ? simulate(stateInput, stateInput.gridBoosters, blendWith.dispatch) : { ...withBooster, sourceBlending: blendWith.diagnostics };
  }
  return { without, withBooster, returnNetwork: calculateReturnNetworkState(stateInput.returnNetwork), comparison: {
    criticalBefore: without.criticalCount,
    criticalAfter: withBooster.criticalAfterCount,
    marginBefore: Object.fromEntries(without.branches.map(branch => [branch.id, branch.margin])),
    marginAfter: Object.fromEntries(withBooster.afterBranches.map(branch => [branch.id, branch.finalMargin])),
    boosterElectricalKW: withBooster.booster.electricalPowerKW,
    usableWasteHeatKW: withBooster.wasteHeatUsedKW,
    centralProductionBeforeKW: without.centralProductionKW,
    centralProductionAfterKW: withBooster.centralProductionKW
  } };
}

export function simulateNetwork(input, prices = {}) {
  return calculateNetworkState(input, input.hmpTargetTemp, prices);
}

export function calculateOperatingCost({ centralPlantKW, wasteHeatKW, electricPowerKW }, prices = {}) {
  return Number(centralPlantKW ?? 0) * Number(prices.centralHeatCostPerMWh ?? 40) / 1000
    + Number(wasteHeatKW ?? 0) * Number(prices.wasteHeatCostPerMWh ?? 5) / 1000
    + Number(electricPowerKW ?? 0) * Number(prices.electricityPricePerMWh ?? 50) / 1000;
}

export function summarizeNetworkFlexState(state, input, prices = {}) {
  const operating = state.withBooster;
  const requiredBoosterThermalKW = state.without.branches.reduce((sum, branch) => sum + (branch.requiredBoosterPowerKW ?? 0), 0);
  const installedBoosterThermalKW = operating.booster.thermalPowerKW;
  const additionalRequiredBoosterThermalKW = operating.afterBranches.reduce((sum, branch) => {
    if (branch.finalMargin == null || branch.flowM3h <= 0) return sum;
    return sum + branch.flowM3h * KW_PER_M3H_K * Math.max(0, -branch.finalMargin);
  }, 0);
  const additionalRequiredBoosterElectricKW = additionalRequiredBoosterThermalKW / Number(input.booster.cop);
  const dataCenterElectricKW = operating.dataCenterElectricPowerKW;
  const totalSystemElectricKW = dataCenterElectricKW + operating.booster.electricalPowerKW;
  const operatingCostPerHour = calculateOperatingCost({ centralPlantKW: operating.centralPlantUsedKW,
    wasteHeatKW: operating.dataCenterSourceHeatUsedKW, electricPowerKW: totalSystemElectricKW }, prices);
  const totalOperatingCostPerHour = operatingCostPerHour + Number(operating.plantRampPenaltyPerHour ?? 0);
  return {
    hmpTargetTemp: operating.hmpTargetTemp,
    hmpTemperatureCapabilityTemp: operating.hmpTemperatureCapabilityTemp,
    hmpTemperatureReachable: operating.hmpTemperatureReachable,
    networkOperatingPointSupported: operating.networkOperatingPointSupported,
    operatingPointStatus: operating.networkOperatingPointSupported ? "SUPPORTED"
      : !operating.hmpTemperatureReachable ? "TEMPERATURE UNSUPPORTED" : "CAPACITY SHORTFALL",
    feasibleBranchesWithoutBooster: operating.feasibleCount,
    branchesRequiringBooster: operating.branchesNeedingBooster,
    requiredBoosterThermalKW,
    requiredBoosterElectricKW: requiredBoosterThermalKW / Number(input.booster.cop),
    installedBoosterThermalKW,
    installedBoosterElectricKW: operating.booster.electricalPowerKW,
    additionalRequiredBoosterThermalKW,
    additionalRequiredBoosterElectricKW,
    installedBoosterCount: operating.booster.installedCount,
    activeBoosterCount: operating.afterBranches.flatMap(branch => branch.gridBoosters).filter(booster => booster.actualLiftK > 0).length,
    usableDataCenterHeatKW: operating.wasteHeatUsedKW,
    selectedDataCenterMode: operating.wasteHeat.mode,
    selectedDataCenterPathEligible: operating.wasteHeat.strictTemperatureEligible ?? operating.wasteHeat.injectionEligible,
    selectedDataCenterPathUsed: operating.wasteHeat.usedInSelectedDispatch ?? operating.wasteHeat.injectedKW > 0,
    selectedDataCenterPathUsedViaBlending: operating.wasteHeat.usedViaBlending ?? false,
    dataCenterModeEligibility: Object.fromEntries(Object.entries(operating.dataCenterModes).map(([mode, result]) => [mode, result.injectionEligible])),
    dataCenterElectricKW,
    dataCenterDeliveredHeatKW: operating.wasteHeat.injectionEligible ? operating.wasteHeat.deliveredHeatKW : 0,
    dataCenterInjectedHeatKW: operating.wasteHeatUsedKW,
    dataCenterTotalCOP: operating.wasteHeat.injectionEligible ? operating.wasteHeat.totalCOP : null,
    centralPlantRequiredKW: operating.centralProductionKW,
    centralPlantActualKW: operating.centralPlantUsedKW,
    centralPlantShortfallKW: operating.centralPlantShortfallKW,
    thermalShortfallKW: operating.hmpPowerShortfallKW,
    totalSystemElectricKW,
    operatingCostPerHour: totalOperatingCostPerHour,
    plantRampPenaltyPerHour: Number(operating.plantRampPenaltyPerHour ?? 0)
  };
}

export function lowestSupportedPoint(points, metric) {
  return points.filter(point => point.operatingPointStatus === "SUPPORTED" && Number.isFinite(point[metric]))
    .reduce((best, point) => best == null || point[metric] < best[metric] ? point : best, null);
}

export function calculateTemperatureFlexSweep(input, hmpTargets, prices = {}) {
  return hmpTargets.map(target => {
    const state = calculateNetworkState(input, Number(target), prices);
    const metrics = summarizeNetworkFlexState(state, input, prices);
    return { ...metrics, state };
  });
}
