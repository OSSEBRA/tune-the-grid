export const WATER_DENSITY = 1000;
export const WATER_CP = 4.186;
export const KW_PER_M3H_K = WATER_DENSITY * WATER_CP / 3600;
export const CLOSE_MARGIN_K = 2;
export const BRANCH_IDS = ["A", "B", "C", "D", "E", "F"];
export const RETURN_VISUAL_ORDER = BRANCH_IDS;
export const RETURN_FLOW_ORDER = [...RETURN_VISUAL_ORDER].reverse();
export const MAX_PIP3_BRANCHES = 3;
const DEFAULT_PIP3_SHARES = { A: 30, B: 55, C: 40, D: 70, E: 100, F: 80 };

function defaultReturnOrder(node, index) {
  const storedOrder = node.order;
  if (storedOrder !== null && storedOrder !== "" && Number.isFinite(Number(storedOrder))) return Number(storedOrder);
  if (node.id === "DC-RETURN") return 10;
  if (node.id === "SM-1") return 15;
  const branchId = node.branchId ?? node.id;
  if (RETURN_FLOW_ORDER.includes(branchId)) return 20 + RETURN_FLOW_ORDER.indexOf(branchId) * 10;
  if (node.id === "PLANT") return 100;
  return 110 + index;
}

export function isReturnSourceUpstreamOfBranch(source, branch) {
  return Number.isFinite(Number(source?.order)) && Number.isFinite(Number(branch?.order))
    && Number(source.order) < Number(branch.order);
}

export function isReturnSourceAvailableToConsumer(source, consumer) {
  return Boolean(source?.enabled !== false && consumer?.enabled !== false
    && source?.type === "WASTE_HEAT_SOURCE" && consumer?.type === "THREE_PIPE_CONSUMER"
    && isReturnSourceUpstreamOfBranch(source, consumer));
}

export function calculateThreePipeExtraction(consumer, availableKW) {
  const demandKW = consumer.enabled === false ? 0 : Math.max(0, Number(consumer.demandKW) || 0);
  const configuredShare = Number(consumer.maxReturnShare);
  const branchId = consumer.branchId ?? consumer.id;
  const defaultShare = DEFAULT_PIP3_SHARES[branchId] ?? 100;
  const maxReturnShare = consumer.maxReturnShare == null || consumer.maxReturnShare === "" ? defaultShare
    : Number.isFinite(configuredShare) ? Math.min(100, Math.max(0, configuredShare)) : defaultShare;
  const maxReturnHeatKW = demandKW * maxReturnShare / 100;
  const maxUptakeKW = Math.max(0, Number(consumer.maxUptakeKW ?? Infinity));
  const allocatedKW = Math.min(demandKW, maxReturnHeatKW, maxUptakeKW, Math.max(0, Number(availableKW) || 0));
  return { demandKW, maxReturnShare, maxReturnHeatKW, allocatedKW, unservedKW: demandKW - allocatedKW };
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
  const nodes = (network.nodes ?? []).map((node, index) => ({ ...node, order: defaultReturnOrder(node, index) }))
    .sort((a, b) => a.order - b.order || String(a.id).localeCompare(String(b.id)));
  const sources = nodes.filter(node => node.type === "WASTE_HEAT_SOURCE").map(source => ({
    ...source, availableKW: source.enabled === false ? 0 : Math.max(0, Number(source.availableKW ?? Number(source.maxPowerMW ?? 0) * 1000) || 0),
    maxInjectionKW: Math.max(0, Number(source.maxInjectionKW ?? Infinity)),
    remainingKW: source.enabled === false ? 0 : Math.min(Math.max(0, Number(source.availableKW ?? Number(source.maxPowerMW ?? 0) * 1000) || 0), Math.max(0, Number(source.maxInjectionKW ?? Infinity))),
    dispatchedKW: 0
  }));
  let activeCount = 0;
  const consumers = nodes.filter(node => node.type === "THREE_PIPE_CONSUMER").map(consumer => {
    const limitExceeded = consumer.enabled !== false && activeCount >= MAX_PIP3_BRANCHES;
    if (consumer.enabled !== false && !limitExceeded) activeCount++;
    const enabled = consumer.enabled !== false && !limitExceeded;
    return { ...consumer, enabled, limitExceeded,
      demandKW: enabled ? Math.max(0, Number(consumer.demandKW) || 0) : 0, allocatedKW: 0,
      unservedKW: enabled ? Math.max(0, Number(consumer.demandKW) || 0) : 0, allocations: [] };
  });

  for (const consumer of consumers) {
    if (consumer.enabled === false) continue;
    const availableBefore = sources.filter(source => isReturnSourceAvailableToConsumer(source, consumer)
      && Number(source.sourceTempC) >= Number(consumer.minimumUsableTempC))
      .reduce((sum, source) => sum + source.remainingKW, 0);
    const eligible = sources.filter(source => isReturnSourceAvailableToConsumer(source, consumer)
      && Number(source.sourceTempC) >= Number(consumer.minimumUsableTempC))
      .sort((a, b) => b.order - a.order || String(a.id).localeCompare(String(b.id)));
    const extraction = calculateThreePipeExtraction(consumer, eligible.reduce((sum, source) => sum + source.remainingKW, 0));
    consumer.maxReturnShare = extraction.maxReturnShare;
    consumer.maxReturnHeatKW = extraction.maxReturnHeatKW;
    let capacity = extraction.allocatedKW;
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
    const upstreamAny = sources.filter(source => Number(source.order) < Number(consumer.order));
    const upstream = sources.filter(source => isReturnSourceAvailableToConsumer(source, consumer));
    const tempEligible = upstream.filter(source => Number(source.sourceTempC) >= Number(consumer.minimumUsableTempC));
    const downstream = sources.filter(source => Number(source.order) > Number(consumer.order));
    const downstreamAvailable = downstream.some(source => source.enabled !== false && source.remainingKW > 0);
    consumer.status = consumer.allocatedKW >= consumer.demandKW && consumer.demandKW > 0 ? "FULLY SUPPLIED"
      : consumer.allocatedKW > 0 ? "PARTIALLY SUPPLIED"
      : upstream.length === 0 ? "NO UPSTREAM SOURCE"
      : tempEligible.length === 0 ? "TEMPERATURE TOO LOW" : "NO RETURN HEAT AVAILABLE";
    consumer.eligibilityStatus = upstream.length === 0 && downstreamAvailable ? "UPSTREAM OF SOURCE"
      : upstreamAny.length === 0 && downstream.length > 0 ? "SOURCE UNAVAILABLE"
        : upstream.length === 0 && upstreamAny.length > 0 ? "SOURCE UNAVAILABLE"
          : upstream.length === 0 ? "NO UPSTREAM SOURCE"
          : tempEligible.length === 0 ? "TEMPERATURE TOO LOW"
            : consumer.maxReturnShare < 100 && availableBefore > consumer.maxReturnHeatKW && consumer.allocatedKW >= consumer.maxReturnHeatKW
              ? "RETURN SHARE LIMITED" : consumer.allocatedKW > 0 ? "RETURN HEAT AVAILABLE" : "NO RETURN HEAT AVAILABLE";
    consumer.supplyTopUpKW = Math.max(0, consumer.demandKW - consumer.allocatedKW);
  }

  for (const consumer of consumers.filter(item => item.limitExceeded)) {
    consumer.maxReturnShare = Math.min(100, Math.max(0, Number(consumer.maxReturnShare ?? 100)));
    consumer.maxReturnHeatKW = 0;
    consumer.supplyTopUpKW = 0;
    consumer.status = "PIP3 LIMIT EXCEEDED";
    consumer.eligibilityStatus = "MAXIMUM 3 PIP3 BRANCHES";
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

export function calculateIndustrialWasteHeat(source = {}, hmpTargetTemp = 0) {
  const sourceTempC = Number(source.sourceTempC ?? 0);
  const lossToHMP = Number(source.lossToHMP ?? 0);
  const availableKW = Number(source.availableThermalKW ?? 0) * Number(source.availabilityPercent ?? 100) / 100;
  const contributionTemp = sourceTempC - lossToHMP;
  const temperatureEligible = contributionTemp >= Number(hmpTargetTemp);
  const usableKW = temperatureEligible ? Math.max(0, availableKW) : 0;
  return { sourceTempC, contributionTemp, lossToHMP, availableKW: Math.max(0, availableKW),
    temperatureEligible, usableKW, injectedKW: 0,
    status: availableKW <= 0 ? "UNAVAILABLE" : !temperatureEligible ? "TEMPERATURE BLOCKED" : "AVAILABLE / NOT USED" };
}

export function calculateWastewaterHeat(source = {}, hmpTargetTemp = 0) {
  const sourceTempC = Number(source.sourceTempC ?? 80);
  const lossToHMP = Number(source.lossToHMP ?? 1);
  const availableKW = Math.max(0, Number(source.availableThermalKW ?? 2500)) * Math.max(0, Number(source.availabilityPercent ?? 100)) / 100;
  const contributionTemp = sourceTempC - lossToHMP;
  const temperatureEligible = source.enabled !== false && contributionTemp >= Number(hmpTargetTemp);
  const usableKW = temperatureEligible ? availableKW : 0;
  return { sourceTempC, contributionTemp, lossToHMP, availableKW, temperatureEligible, usableKW, injectedKW: 0,
    status: source.enabled === false || availableKW <= 0 ? "UNAVAILABLE" : !temperatureEligible ? "TEMPERATURE BLOCKED" : "AVAILABLE / NOT USED" };
}

export function dispatchFlexibleHeatSinks(operating, flexibleSinks = {}, returnNetwork = {}, prices = {}) {
  const network = { ...returnNetwork, sources: (returnNetwork.sources ?? []).map(source => ({ ...source })),
    nodes: (returnNetwork.nodes ?? []).map(node => ({ ...node })) };
  const greenhouse = flexibleSinks.greenhouse ?? {};
  const cooling = flexibleSinks.absorptionCooling ?? {};
  const supplySources = [
    { id: "DATA-CENTER-SUPPLY", remainingKW: operating.wasteHeat?.mode === "raw-return" ? 0
      : Math.max(0, Number(operating.wasteHeat?.usableKW ?? 0) - Number(operating.dataCenterHeatUsedKW ?? 0)) },
    { id: "INDUSTRIAL", remainingKW: Math.max(0, Number(operating.industrialWasteHeat?.usableKW ?? 0) - Number(operating.industrialWasteHeat?.injectedKW ?? 0)) },
    { id: "WASTEWATER", remainingKW: Math.max(0, Number(operating.wastewaterHeat?.usableKW ?? 0) - Number(operating.wastewaterHeat?.injectedKW ?? 0)) }
  ];
  for (const source of supplySources) source.flexibleUsedKW = 0;
  const allocateSupply = amount => {
    let remaining = amount;
    for (const source of supplySources) {
      const used = Math.min(remaining, source.remainingKW);
      source.remainingKW -= used;
      source.flexibleUsedKW += used;
      remaining -= used;
      if (remaining <= 1e-9) break;
    }
  };
  let supplyRemainingKW = supplySources.reduce((sum, source) => sum + source.remainingKW, 0);
  const returnSources = network.sources.filter(source => source.enabled !== false
    && Number(source.sourceTempC) >= Number(greenhouse.minimumTemperatureC ?? 50));
  let returnRemainingKW = returnSources.reduce((sum, source) => sum + Math.max(0, Number(source.remainingKW ?? 0)), 0);
  const greenhouseDemandKW = greenhouse.enabled === false ? 0 : Math.max(0, Number(greenhouse.maxDemandKW ?? 2500));
  const minGreenhouseTemp = Number(greenhouse.minimumTemperatureC ?? 50);
  const mode = ["supply", "return", "auto"].includes(greenhouse.connectionMode) ? greenhouse.connectionMode : "auto";
  let greenhouseReturnKW = 0, greenhouseSupplyKW = 0;
  if (greenhouse.enabled !== false && mode !== "supply") greenhouseReturnKW = Math.min(greenhouseDemandKW, returnRemainingKW);
  if (greenhouse.enabled !== false && mode !== "return") greenhouseSupplyKW = Math.min(greenhouseDemandKW - greenhouseReturnKW, supplyRemainingKW);
  let returnToAllocate = greenhouseReturnKW;
  for (const source of returnSources) {
    const allocatedKW = Math.min(returnToAllocate, Math.max(0, Number(source.remainingKW ?? 0)));
    source.remainingKW = Math.max(0, Number(source.remainingKW ?? 0) - allocatedKW);
    source.flexibleSinkKW = allocatedKW;
    returnToAllocate -= allocatedKW;
    if (returnToAllocate <= 1e-9) break;
  }
  const usedSupplyKW = greenhouseSupplyKW;
  allocateSupply(usedSupplyKW);
  supplyRemainingKW = Math.max(0, supplyRemainingKW - usedSupplyKW);
  const coolingMinTemp = Number(cooling.minimumDrivingTempC ?? 80);
  const coolingEnabled = cooling.enabled !== false;
  const coolingTemperatureEligible = Number(operating.hmpTargetTemp) >= coolingMinTemp;
  const coolingAvailableKW = coolingEnabled && coolingTemperatureEligible
    ? Math.min(supplyRemainingKW, Math.max(0, Number(cooling.maxHeatInputKW ?? 2000))) : 0;
  const coolingCOP = Math.max(0, Number(cooling.thermalCOP ?? 0.7));
  const coolingOutputKW = coolingAvailableKW * coolingCOP;
  const coolingRevenuePerHour = coolingOutputKW * Math.max(0, Number(prices.coolingPricePerMWh ?? 50)) / 1000;
  allocateSupply(coolingAvailableKW);
  const surplusHeatKW = supplySources.reduce((sum, source) => sum + source.remainingKW + source.flexibleUsedKW, 0) + returnRemainingKW;
  const flexibleSinkHeatKW = greenhouseReturnKW + greenhouseSupplyKW + coolingAvailableKW;
  const curtailedHeatKW = Math.max(0, surplusHeatKW - flexibleSinkHeatKW);
  network.unusedSourceKW = Math.max(0, Number(network.unusedSourceKW ?? 0) - greenhouseReturnKW);
  operating.flexibleSinks = { greenhouse: { enabled: greenhouse.enabled !== false, connectionMode: mode,
    minimumTemperatureC: minGreenhouseTemp, supplyHeatKW: greenhouseSupplyKW, returnHeatKW: greenhouseReturnKW,
    totalHeatKW: greenhouseSupplyKW + greenhouseReturnKW,
    status: greenhouse.enabled === false ? "DISABLED" : greenhouseReturnKW + greenhouseSupplyKW > 0 ? "USING HEAT" : "NO ELIGIBLE SURPLUS" },
    absorptionCooling: { enabled: coolingEnabled, temperatureEligible: coolingTemperatureEligible,
      heatInputKW: coolingAvailableKW, minimumDrivingTempC: coolingMinTemp, thermalCOP: coolingCOP,
      coolingOutputKW, coolingRevenuePerHour,
      status: !coolingEnabled ? "DISABLED" : !coolingTemperatureEligible ? "TEMPERATURE LIMITED" : coolingAvailableKW > 0 ? "USING HEAT" : "NO ELIGIBLE SURPLUS" },
    surplusHeatKW, flexibleSinkHeatKW, curtailedHeatKW,
    supplyBySourceKW: Object.fromEntries(supplySources.map(source => [source.id, source.flexibleUsedKW])) };
  operating.wasteHeat.flexibleDeliveredHeatKW = supplySources.find(source => source.id === "DATA-CENTER-SUPPLY")?.flexibleUsedKW ?? 0;
  operating.industrialWasteHeat.flexibleUsedKW = supplySources.find(source => source.id === "INDUSTRIAL")?.flexibleUsedKW ?? 0;
  operating.wastewaterHeat.flexibleUsedKW = supplySources.find(source => source.id === "WASTEWATER")?.flexibleUsedKW ?? 0;
  operating.returnHeatRecoveredForSinksKW = greenhouseReturnKW;
  const dcReturn = network.sources.find(source => source.id === "DC-RETURN");
  operating.returnHeatSourceCostKW = Number(dcReturn?.dispatchedKW ?? 0) + Number(dcReturn?.flexibleSinkKW ?? 0);
  operating.returnNetwork = network;
  return operating.flexibleSinks;
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
  const industrial = input.industrialWasteHeat;
  if (industrial) {
    for (const key of ["sourceTempC", "availableThermalKW", "availabilityPercent", "lossToHMP"])
      if (industrial[key] === "" || !Number.isFinite(Number(industrial[key]))) errors.push(`industrialWasteHeat.${key} must be a number.`);
    if (Number(industrial.availableThermalKW) < 0) errors.push("Industrial waste-heat capacity cannot be negative.");
    if (Number(industrial.availabilityPercent) < 0 || Number(industrial.availabilityPercent) > 100) errors.push("Industrial waste-heat availability must be between 0 and 100%.");
    if (Number(industrial.lossToHMP) < 0) errors.push("Industrial source-to-HMP temperature loss cannot be negative.");
  }
  const wastewater = input.wastewaterHeat;
  if (wastewater) {
    for (const key of ["sourceTempC", "availableThermalKW", "availabilityPercent", "lossToHMP"])
      if (wastewater[key] === "" || !Number.isFinite(Number(wastewater[key]))) errors.push(`wastewaterHeat.${key} must be a number.`);
    if (Number(wastewater.availableThermalKW) < 0) errors.push("Wastewater heat capacity cannot be negative.");
    if (Number(wastewater.availabilityPercent) < 0 || Number(wastewater.availabilityPercent) > 100) errors.push("Wastewater heat availability must be between 0 and 100%.");
    if (Number(wastewater.lossToHMP) < 0) errors.push("Wastewater source-to-HMP temperature loss cannot be negative.");
  }
  for (const [path, value] of [["flexibleSinks.greenhouse.maxDemandKW", input.flexibleSinks?.greenhouse?.maxDemandKW],
    ["flexibleSinks.greenhouse.minimumTemperatureC", input.flexibleSinks?.greenhouse?.minimumTemperatureC],
    ["flexibleSinks.absorptionCooling.maxHeatInputKW", input.flexibleSinks?.absorptionCooling?.maxHeatInputKW],
    ["flexibleSinks.absorptionCooling.minimumDrivingTempC", input.flexibleSinks?.absorptionCooling?.minimumDrivingTempC],
    ["flexibleSinks.absorptionCooling.thermalCOP", input.flexibleSinks?.absorptionCooling?.thermalCOP]])
    if (value != null && (value === "" || !Number.isFinite(Number(value)))) errors.push(`${path} must be a number.`);
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
  const industrialWasteHeat = calculateIndustrialWasteHeat(input.industrialWasteHeat, input.hmpTargetTemp);
  const wastewaterHeat = calculateWastewaterHeat(input.wastewaterHeat ?? { enabled: false }, input.hmpTargetTemp);
  // Deterministic supply dispatch: Data Center, Industrial, Wastewater, then central residual.
  const dataCenterHeatUsedKW = wasteHeat.injectionEligible ? Math.min(totalDemandKW, wasteHeat.injectedKW) : 0;
  industrialWasteHeat.injectedKW = Math.min(Math.max(0, totalDemandKW - dataCenterHeatUsedKW), industrialWasteHeat.usableKW);
  if (industrialWasteHeat.injectedKW > 0) industrialWasteHeat.status = "INJECTING";
  wastewaterHeat.injectedKW = Math.min(Math.max(0, totalDemandKW - dataCenterHeatUsedKW - industrialWasteHeat.injectedKW), wastewaterHeat.usableKW);
  if (wastewaterHeat.injectedKW > 0) wastewaterHeat.status = "INJECTING";
  const plantCanContribute = centralPlant.availableKW > 0;
  const sourceTemperatures = [];
  if (plantCanContribute) sourceTemperatures.push(centralPlant.contributionTemp);
  if (wasteHeat.mode !== "raw-return" && wasteHeat.availableKW > 0 && wasteHeat.contributionTemp != null) sourceTemperatures.push(wasteHeat.contributionTemp);
  if (industrialWasteHeat.availableKW > 0) sourceTemperatures.push(industrialWasteHeat.contributionTemp);
  if (input.wastewaterHeat && input.wastewaterHeat.enabled !== false && wastewaterHeat.availableKW > 0) sourceTemperatures.push(wastewaterHeat.contributionTemp);
  const highestAvailableSourceTemp = sourceTemperatures.length ? Math.max(...sourceTemperatures) : null;
  // This is temperature capability at the HMP setpoint, not a mixed or achieved network temperature.
  // Mixing cannot be calculated without adequate flow and return-temperature data.
  const hmpTemperatureCapabilityTemp = sourceOverride?.mixedSupplyTemp ?? (highestAvailableSourceTemp == null ? null : Math.min(Number(input.hmpTargetTemp), highestAvailableSourceTemp));
  const networkReturnTemp = Number(input.networkReturnTemp ?? 40);
  const networkDeltaK = Number(input.hmpTargetTemp) - networkReturnTemp;
  const referenceNetworkDeltaK = input.referenceNetworkDeltaK == null || input.referenceNetworkDeltaK === "" ? null : Number(input.referenceNetworkDeltaK);
  const wasteHeatUsedKW = dataCenterHeatUsedKW;
  const totalWasteHeatUsedKW = dataCenterHeatUsedKW + industrialWasteHeat.injectedKW + wastewaterHeat.injectedKW;
  const injectedFraction = wasteHeat.injectionEligible && wasteHeat.deliveredHeatKW > 0 ? wasteHeat.injectedKW / wasteHeat.deliveredHeatKW : 0;
  const dataCenterSourceHeatUsedKW = wasteHeat.sourceHeatKW * injectedFraction;
  const dataCenterElectricPowerKW = wasteHeat.electricalPowerKW * injectedFraction;
  const centralProductionKW = Math.max(0, totalDemandKW - totalWasteHeatUsedKW);
  const centralPlantUsedKW = Math.min(centralProductionKW, centralPlant.usableKW);
  const centralPlantShortfallKW = Math.max(0, centralProductionKW - centralPlantUsedKW);
  const hmpPowerAvailableKW = wasteHeat.usableKW + industrialWasteHeat.usableKW + wastewaterHeat.usableKW + centralPlant.usableKW;
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
    wasteHeat, dataCenterModes, wasteHeatUsedKW, dataCenterHeatUsedKW, dataCenterSourceHeatUsedKW, dataCenterElectricPowerKW,
    industrialWasteHeat, industrialWasteHeatUsedKW: industrialWasteHeat.injectedKW, wastewaterHeat,
    wastewaterHeatUsedKW: wastewaterHeat.injectedKW, totalWasteHeatUsedKW, centralProductionKW,
    sourceBlending: sourceOverride?.diagnostics ?? null,
    plantRampPenaltyPerHour: sourceOverride?.diagnostics?.rampPenaltyPerHour ?? 0,
    booster: { branchId: input.booster.branchId, installedCount: installedBoosters.length,
      thermalPowerKW: totalBoosterPowerKW, electricalPowerKW: totalBoosterElectricKW,
      requestedPowerKW: totalBoosterRequestedKW, capacityKW: allGridBoosters.reduce((sum, item) => sum + Number(item.maxThermalKW), 0),
      capacitySufficient: allGridBoosters.every(item => item.capacitySufficient) }
  };
}

function estimatedSourceFlows(plantKW, plantAtHMP, dcKW, dcAtHMP, industrialKW, industrialAtHMP, wastewaterKW, wastewaterAtHMP, returnTemp) {
  const plantFlowM3h = plantKW === 0 ? 0 : plantKW / (KW_PER_M3H_K * (plantAtHMP - returnTemp));
  const dataCenterFlowM3h = dcKW === 0 ? 0 : dcKW / (KW_PER_M3H_K * (dcAtHMP - returnTemp));
  const industrialFlowM3h = industrialKW === 0 ? 0 : industrialKW / (KW_PER_M3H_K * (industrialAtHMP - returnTemp));
  const wastewaterFlowM3h = wastewaterKW === 0 ? 0 : wastewaterKW / (KW_PER_M3H_K * (wastewaterAtHMP - returnTemp));
  const flows = [plantFlowM3h, dataCenterFlowM3h, industrialFlowM3h, wastewaterFlowM3h];
  if (!flows.every(Number.isFinite) || flows.some(flow => flow < 0) || flows.reduce((sum, flow) => sum + flow, 0) <= 0) return null;
  const totalFlow = flows.reduce((sum, flow) => sum + flow, 0);
  return { plantFlowM3h, dataCenterFlowM3h, industrialFlowM3h, wastewaterFlowM3h,
    mixedSupplyTemp: (plantFlowM3h * plantAtHMP + dataCenterFlowM3h * dcAtHMP + industrialFlowM3h * industrialAtHMP + wastewaterFlowM3h * wastewaterAtHMP) / totalFlow };
}

export function calculateBlendedSourceState(input, strictState, installedBoosters, prices = {}) {
  const demandKW = strictState.totalDemandKW, dcPath = strictState.dataCenterModes[input.wasteHeat.mode];
  const normal = Number(input.normalPlantSupplyTemp), maximum = Number(input.maxRampedPlantSupplyTemp);
  const loss = Number(input.centralPlant.lossToHMP), target = Number(input.hmpTargetTemp), returnTemp = Number(input.networkReturnTemp ?? 40);
  const dcAtHMP = dcPath.contributionTemp;
  const industrial = calculateIndustrialWasteHeat(input.industrialWasteHeat, target);
  const wastewater = calculateWastewaterHeat(input.wastewaterHeat ?? { enabled: false }, target);
  const maxDataCenterKW = Math.min(demandKW, dcPath.deliveredHeatKW);
  const strictCost = calculateOperatingCost({ centralPlantKW: strictState.centralPlantUsedKW,
    wasteHeatKW: strictState.dataCenterSourceHeatUsedKW,
    industrialWasteHeatKW: strictState.industrialWasteHeatUsedKW,
    wastewaterHeatKW: strictState.wastewaterHeatUsedKW,
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
    const industrialKW = industrial.temperatureEligible ? Math.min(industrial.availableKW, Math.max(0, demandKW - dataCenterKW)) : 0;
    const wastewaterKW = wastewater.temperatureEligible ? Math.min(wastewater.availableKW, Math.max(0, demandKW - dataCenterKW - industrialKW)) : 0;
    const plantKW = Math.max(0, demandKW - dataCenterKW - industrialKW - wastewaterKW);
    if (plantKW > strictState.centralPlant.availableKW + 1e-9) { sawCapacityShortfall = true; continue; }
    const mixAt = supply => estimatedSourceFlows(plantKW, supply - loss, dataCenterKW, dcAtHMP,
      industrialKW, industrial.contributionTemp, wastewaterKW, wastewater.contributionTemp, returnTemp);
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
      industrialWasteHeatKW: candidate.industrialWasteHeatUsedKW,
      wastewaterHeatKW: candidate.wastewaterHeatUsedKW,
      electricPowerKW: candidate.dataCenterElectricPowerKW + candidate.booster.electricalPowerKW }, prices) + rampPenaltyPerHour;
    if (!best || costPerHour < best.costPerHour) best = { candidate, centralPlant, wasteHeat, mix,
      dataCenterKW, industrialKW, wastewaterKW, plantKW, requiredPlantSupplyTemp, rampK, rampPenaltyPerHour, costPerHour };
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
    wastewaterHeatUsedKW: best.wastewaterKW,
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
  const returnNetwork = calculateReturnNetworkState(stateInput.returnNetwork);
  const flexibleSinks = stateInput.flexibleSinks ?? { greenhouse: { enabled: false }, absorptionCooling: { enabled: false } };
  dispatchFlexibleHeatSinks(without, flexibleSinks, returnNetwork, prices);
  dispatchFlexibleHeatSinks(withBooster, flexibleSinks, returnNetwork, prices);
  return { without, withBooster, returnNetwork: withBooster.returnNetwork, comparison: {
    criticalBefore: without.criticalCount,
    criticalAfter: withBooster.criticalAfterCount,
    marginBefore: Object.fromEntries(without.branches.map(branch => [branch.id, branch.margin])),
    marginAfter: Object.fromEntries(withBooster.afterBranches.map(branch => [branch.id, branch.finalMargin])),
    boosterElectricalKW: withBooster.booster.electricalPowerKW,
    usableWasteHeatKW: withBooster.totalWasteHeatUsedKW,
    centralProductionBeforeKW: without.centralProductionKW,
    centralProductionAfterKW: withBooster.centralProductionKW
  } };
}

export function simulateNetwork(input, prices = {}) {
  return calculateNetworkState(input, input.hmpTargetTemp, prices);
}

export function calculateOperatingCost({ centralPlantKW, wasteHeatKW, industrialWasteHeatKW = 0, wastewaterHeatKW = 0, electricPowerKW }, prices = {}) {
  return Number(centralPlantKW ?? 0) * Number(prices.centralHeatCostPerMWh ?? 76) / 1000
    + Number(wasteHeatKW ?? 0) * Number(prices.wasteHeatCostPerMWh ?? 10) / 1000
    + Number(industrialWasteHeatKW ?? 0) * Number(prices.industrialWasteHeatCostPerMWh ?? 10) / 1000
    + Number(wastewaterHeatKW ?? 0) * Number(prices.wastewaterHeatCostPerMWh ?? 25) / 1000
    + Number(electricPowerKW ?? 0) * Number(prices.electricityPricePerMWh ?? 70) / 1000;
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
  const flexibleDCFraction = operating.wasteHeat.deliveredHeatKW > 0
    ? Number(operating.wasteHeat.flexibleDeliveredHeatKW ?? 0) / operating.wasteHeat.deliveredHeatKW : 0;
  const flexibleDCElectricKW = Number(operating.wasteHeat.electricalPowerKW ?? 0) * flexibleDCFraction;
  const dataCenterElectricKW = operating.dataCenterElectricPowerKW + flexibleDCElectricKW;
  const totalSystemElectricKW = dataCenterElectricKW + operating.booster.electricalPowerKW;
  const operatingCostPerHour = calculateOperatingCost({ centralPlantKW: operating.centralPlantUsedKW,
    wasteHeatKW: operating.dataCenterSourceHeatUsedKW + Number(operating.returnHeatSourceCostKW ?? 0)
      + Number(operating.wasteHeat.sourceHeatKW ?? 0) * flexibleDCFraction,
    industrialWasteHeatKW: operating.industrialWasteHeatUsedKW + Number(operating.industrialWasteHeat.flexibleUsedKW ?? 0),
    wastewaterHeatKW: operating.wastewaterHeatUsedKW + Number(operating.wastewaterHeat.flexibleUsedKW ?? 0),
    electricPowerKW: totalSystemElectricKW }, prices);
  const grossOperatingCostPerHour = operatingCostPerHour + Number(operating.plantRampPenaltyPerHour ?? 0);
  const coolingRevenuePerHour = Number(operating.flexibleSinks?.absorptionCooling.coolingRevenuePerHour ?? 0);
  const totalOperatingCostPerHour = grossOperatingCostPerHour - coolingRevenuePerHour;
  const flexibleSupplyHeatKW = Number(operating.flexibleSinks?.greenhouse.supplyHeatKW ?? 0)
    + Number(operating.flexibleSinks?.absorptionCooling.heatInputKW ?? 0);
  const flexibleBySource = operating.flexibleSinks?.supplyBySourceKW ?? {};
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
    dataCenterHeatUsedKW: operating.dataCenterHeatUsedKW,
    dataCenterFlexibleHeatUsedKW: Number(flexibleBySource["DATA-CENTER-SUPPLY"] ?? 0),
    industrialWasteHeatUsedKW: operating.industrialWasteHeatUsedKW,
    industrialFlexibleHeatUsedKW: Number(flexibleBySource.INDUSTRIAL ?? 0),
    wastewaterHeatUsedKW: operating.wastewaterHeatUsedKW,
    wastewaterFlexibleHeatUsedKW: Number(flexibleBySource.WASTEWATER ?? 0),
    wastewaterHeatAvailableKW: operating.wastewaterHeat.availableKW,
    wastewaterHeatContributionTempC: operating.wastewaterHeat.contributionTemp,
    wastewaterHeatTemperatureEligible: operating.wastewaterHeat.temperatureEligible,
    flexibleSinks: operating.flexibleSinks,
    surplusHeatKW: operating.flexibleSinks?.surplusHeatKW ?? 0,
    flexibleSinkHeatKW: operating.flexibleSinks?.flexibleSinkHeatKW ?? 0,
    curtailedHeatKW: operating.flexibleSinks?.curtailedHeatKW ?? 0,
    coolingOutputKW: operating.flexibleSinks?.absorptionCooling.coolingOutputKW ?? 0,
    coolingRevenuePerHour: operating.flexibleSinks?.absorptionCooling.coolingRevenuePerHour ?? 0,
    usableWasteHeatKW: operating.totalWasteHeatUsedKW + flexibleSupplyHeatKW,
    selectedDataCenterMode: operating.wasteHeat.mode,
    selectedDataCenterPathEligible: operating.wasteHeat.strictTemperatureEligible ?? operating.wasteHeat.injectionEligible,
    selectedDataCenterPathUsed: operating.wasteHeat.usedInSelectedDispatch ?? operating.wasteHeat.injectedKW > 0,
    selectedDataCenterPathUsedViaBlending: operating.wasteHeat.usedViaBlending ?? false,
    dataCenterModeEligibility: Object.fromEntries(Object.entries(operating.dataCenterModes).map(([mode, result]) => [mode, result.injectionEligible])),
    dataCenterElectricKW,
    dataCenterDeliveredHeatKW: operating.wasteHeat.injectionEligible ? operating.wasteHeat.deliveredHeatKW : 0,
    dataCenterInjectedHeatKW: operating.wasteHeatUsedKW,
    industrialWasteHeatAvailableKW: operating.industrialWasteHeat.availableKW,
    industrialWasteHeatContributionTempC: operating.industrialWasteHeat.contributionTemp,
    industrialWasteHeatTemperatureEligible: operating.industrialWasteHeat.temperatureEligible,
    dataCenterTotalCOP: operating.wasteHeat.injectionEligible ? operating.wasteHeat.totalCOP : null,
    centralPlantRequiredKW: operating.centralProductionKW,
    centralPlantActualKW: operating.centralPlantUsedKW,
    centralPlantShortfallKW: operating.centralPlantShortfallKW,
    thermalShortfallKW: operating.hmpPowerShortfallKW,
    totalSystemElectricKW,
    operatingCostPerHour: totalOperatingCostPerHour,
    grossOperatingCostPerHour,
    netOperatingCostPerHour: totalOperatingCostPerHour,
    coolingRevenuePerHour,
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
