import { simulateNetwork, summarizeNetworkFlexState } from "./network-model.js?v=20261023-1";
import { analyzeSystemOpportunity, createScenarioSnapshot, restoreScenarioSnapshot } from "./network-insights.js?v=20261023-1";

const clone = value => globalThis.structuredClone ? structuredClone(value) : JSON.parse(JSON.stringify(value));
const finite = value => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
const validSnapshot = snapshot => snapshot?.input && snapshot?.prices
  && ["electricityPricePerMWh", "centralHeatCostPerMWh", "wasteHeatCostPerMWh"].every(key => finite(snapshot.prices[key]))
  && (snapshot.prices.industrialWasteHeatCostPerMWh == null || finite(snapshot.prices.industrialWasteHeatCostPerMWh))
  && Array.isArray(snapshot.input.branches) && snapshot.input.centralPlant && snapshot.input.wasteHeat
  && snapshot.input.returnNetwork && snapshot.input.booster && Array.isArray(snapshot.input.gridBoosters);
const mwh = (kw, hours) => Number(kw ?? 0) * hours / 1000;

export function createOperatingBin({ id = globalThis.crypto?.randomUUID?.() ?? `bin-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  label = "Operating bin", hoursPerYear = 0, snapshot }) {
  if (!validSnapshot(snapshot)) throw new TypeError("A complete model and price snapshot is required.");
  return { id: String(id), label: String(label), hoursPerYear: finite(hoursPerYear) ? Number(hoursPerYear) : hoursPerYear,
    snapshot: createScenarioSnapshot(snapshot.input, snapshot.prices, snapshot.savedAt ?? null) };
}

export function createAnnualProfile(bins = []) {
  return { bins: bins.map(bin => clone(bin)) };
}

export function duplicateAnnualProfile(profile) {
  return createAnnualProfile(profile?.bins ?? []);
}

export function updateOperatingBin(profile, id, changes) {
  return { bins: (profile?.bins ?? []).map(bin => bin.id === id
    ? { ...clone(bin), ...clone(changes), snapshot: clone(changes.snapshot ?? bin.snapshot) } : clone(bin)) };
}

function calculateOperatingBin(bin) {
  const hours = Number(bin.hoursPerYear);
  if (!bin.id || !String(bin.label).trim() || !finite(hours) || hours < 0 || !validSnapshot(bin.snapshot)) {
    return { bin, status: "INVALID BIN", error: "Check the label, hours, and complete model snapshot." };
  }
  try {
    const { input, prices } = restoreScenarioSnapshot(bin.snapshot);
    if (!Object.values(prices).every(finite)) throw new TypeError("All bin prices must be finite values.");
    const state = simulateNetwork(input, prices);
    const point = summarizeNetworkFlexState(state, input, prices);
    const operating = state.withBooster;
    const opportunity = analyzeSystemOpportunity(input, state);
    const returnNodes = state.returnNetwork?.nodes ?? [];
    const returnHeatKW = returnNodes.filter(node => node.type === "THREE_PIPE_CONSUMER")
      .reduce((sum, node) => sum + Number(node.allocatedKW ?? 0), 0);
    const pip3BySourceKW = {};
    for (const consumer of state.returnNetwork?.consumers ?? []) for (const allocation of consumer.allocations ?? []) {
      pip3BySourceKW[allocation.sourceId] = (pip3BySourceKW[allocation.sourceId] ?? 0) + Number(allocation.allocatedKW ?? 0);
    }
    const boosters = new Map((input.gridBoosters ?? []).map(booster => [booster.id, { id: booster.id, branchId: booster.branchId,
      thermalKW: 0, electricKW: 0, peakThermalKW: 0, maxLiftK: 0, activeHours: 0 }]));
    for (const branch of operating.afterBranches) for (const booster of branch.gridBoosters ?? []) {
      const total = boosters.get(booster.id);
      if (!total) continue;
      total.thermalKW += Number(booster.thermalPowerKW ?? 0);
      total.electricKW += Number(booster.electricalPowerKW ?? 0);
      total.peakThermalKW = Math.max(total.peakThermalKW, Number(booster.thermalPowerKW ?? 0));
      total.maxLiftK = Math.max(total.maxLiftK, Number(booster.actualLiftK ?? 0));
      if (Number(booster.actualLiftK ?? 0) > 0) total.activeHours = hours;
    }
    const constraintKey = constraint => constraint.type === "branch-temperature" ? `branch-${constraint.branchId}` : constraint.type;
    const sourceCapacityConstrained = opportunity.constraints.some(constraint => constraint.type === "source-capacity");
    const branchTemperatureConstrained = opportunity.constraints.some(constraint => constraint.type === "branch-temperature");
    const status = !operating.hmpTemperatureReachable ? "TEMPERATURE UNSUPPORTED"
      : sourceCapacityConstrained || Number(operating.hmpPowerShortfallKW) > 1e-8 ? "CAPACITY SHORTFALL"
        : branchTemperatureConstrained ? "BRANCH TEMPERATURE CONSTRAINT"
          : point.networkOperatingPointSupported ? "SUPPORTED" : point.operatingPointStatus;
    const metrics = {
      status,
      supported: status === "SUPPORTED",
      usableSupplyHeatKW: point.usableWasteHeatKW,
      totalWasteHeatUsedKW: point.usableWasteHeatKW,
      dataCenterSupplyHeatKW: point.dataCenterHeatUsedKW + point.dataCenterFlexibleHeatUsedKW,
      industrialSupplyHeatKW: point.industrialWasteHeatUsedKW + point.industrialFlexibleHeatUsedKW,
      wastewaterSupplyHeatKW: point.wastewaterHeatUsedKW + point.wastewaterFlexibleHeatUsedKW,
      greenhouseHeatUseKW: operating.flexibleSinks?.greenhouse.totalHeatKW ?? 0,
      greenhouseReturnHeatKW: operating.flexibleSinks?.greenhouse.returnHeatKW ?? 0,
      greenhouseSupplyHeatKW: operating.flexibleSinks?.greenhouse.supplyHeatKW ?? 0,
      absorptionHeatInputKW: operating.flexibleSinks?.absorptionCooling.heatInputKW ?? 0,
      coolingOutputKW: operating.flexibleSinks?.absorptionCooling.coolingOutputKW ?? 0,
      curtailedHeatKW: operating.flexibleSinks?.curtailedHeatKW ?? 0,
      surplusHeatKW: operating.flexibleSinks?.surplusHeatKW ?? 0,
      flexibleSinkHeatKW: operating.flexibleSinks?.flexibleSinkHeatKW ?? 0,
      rawReturnHeatKW: pip3BySourceKW["DC-RETURN"] ?? 0,
      otherReturnHeatKW: returnHeatKW - (pip3BySourceKW["DC-RETURN"] ?? 0),
      supermarketReturnHeatKW: pip3BySourceKW["SM-1"] ?? 0,
      returnTemperatureBeforeRecoveryC: state.returnNetwork.returnTempBeforeRecoveryC,
      returnTemperatureAtPlantC: state.returnNetwork.returnTempAtPlantC,
      dispatchStrategy: input.supplyDispatchStrategy ?? "waste-heat-priority",
      selectedSourceMixKW: { ...(operating.supplyDispatch ?? {}) },
      availableUpgradedSupplyHeatKW: point.dataCenterDeliveredHeatKW,
      upgradedSupplyHeatKW: point.dataCenterInjectedHeatKW,
      centralProductionKW: point.centralPlantActualKW,
      gridboosterThermalKW: point.installedBoosterThermalKW,
      gridboosterElectricKW: operating.booster.electricalPowerKW,
      dataCenterElectricKW: point.dataCenterElectricKW,
      totalElectricKW: point.totalSystemElectricKW,
      supplyTopUpKW: returnNodes.filter(node => node.type === "THREE_PIPE_CONSUMER").reduce((sum, node) => sum + Number(node.unservedKW ?? 0), 0),
      returnHeatKW,
      centralHeatCostPerHour: operating.centralPlantUsedKW * Number(prices.centralHeatCostPerMWh ?? 76) / 1000,
      wasteHeatCostPerHour: (operating.dataCenterSourceHeatUsedKW + Number(operating.returnHeatSourceCostKW ?? 0)
        + (operating.wasteHeat.deliveredHeatKW > 0 ? operating.wasteHeat.sourceHeatKW * Number(operating.wasteHeat.flexibleDeliveredHeatKW ?? 0) / operating.wasteHeat.deliveredHeatKW : 0)) * Number(prices.wasteHeatCostPerMWh ?? 10) / 1000,
      industrialWasteHeatCostPerHour: (operating.industrialWasteHeatUsedKW + Number(operating.industrialWasteHeat.flexibleUsedKW ?? 0)) * Number(prices.industrialWasteHeatCostPerMWh ?? 10) / 1000,
      wastewaterHeatCostPerHour: (operating.wastewaterHeatUsedKW + Number(operating.wastewaterHeat.flexibleUsedKW ?? 0)) * Number(prices.wastewaterHeatCostPerMWh ?? 25) / 1000,
      coolingRevenuePerHour: operating.flexibleSinks?.absorptionCooling.coolingRevenuePerHour ?? 0,
      electricityCostPerHour: (point.totalSystemElectricKW * Number(prices.electricityPricePerMWh ?? 70)) / 1000,
      plantRampPenaltyPerHour: Number(operating.plantRampPenaltyPerHour ?? 0),
      operatingCostPerHour: point.operatingCostPerHour,
      primaryConstraint: constraintKey(opportunity.primary),
      constraintsPresent: opportunity.constraints.map(constraintKey),
      gridBoosters: [...boosters.values()].map(item => ({ ...item,
        thermalMWh: mwh(item.thermalKW, hours), electricMWh: mwh(item.electricKW, hours) })),
      dataCenterMode: input.wasteHeat.mode,
      sourceHeatUsedKW: operating.dataCenterSourceHeatUsedKW,
      rawSourceHeatKW: operating.wasteHeat.mode === "raw-return" ? pip3BySourceKW["DC-RETURN"] ?? 0 : operating.dataCenterSourceHeatUsedKW,
      pip3BySourceKW,
      oneStageSupplyMode: input.wasteHeat.mode === "one-stage",
      twoStageSupplyMode: input.wasteHeat.mode === "two-stage"
    };
    return { bin, input, prices, state, point, status: metrics.status, metrics, hours };
  } catch (error) {
    return { bin, status: "INVALID BIN", error: error.message };
  }
}

export function calculateAnnualProfile(profile) {
  const bins = profile?.bins ?? [];
  const ids = bins.map(bin => bin.id);
  const duplicateIds = new Set(ids.filter((id, index) => ids.indexOf(id) !== index));
  const results = bins.map(bin => duplicateIds.has(bin.id)
    ? { bin, status: "INVALID BIN", error: "Bin IDs must be unique." } : calculateOperatingBin(bin));
  const totalHours = bins.reduce((sum, bin) => sum + (finite(bin.hoursPerYear) && Number(bin.hoursPerYear) >= 0 ? Number(bin.hoursPerYear) : 0), 0);
  const totals = { supportedHours: 0, temperatureUnsupportedHours: 0, branchTemperatureConstraintHours: 0,
    capacityShortfallHours: 0, invalidHours: 0, pip3BySourceMWh: {},
    usableSupplyHeatMWh: 0, totalWasteHeatUsedMWh: 0, dataCenterSupplyHeatMWh: 0, industrialSupplyHeatMWh: 0, wastewaterSupplyHeatMWh: 0,
    greenhouseHeatUseMWh: 0, greenhouseReturnHeatMWh: 0, greenhouseSupplyHeatMWh: 0, flexibleSinkHeatMWh: 0,
    supermarketReturnHeatMWh: 0, absorptionHeatInputMWh: 0, coolingOutputMWh: 0, surplusHeatMWh: 0, curtailedHeatMWh: 0,
    availableUpgradedSupplyHeatMWh: 0, rawReturnHeatMWh: 0,
    upgradedSupplyHeatMWh: 0, otherReturnHeatMWh: 0, sourceHeatUsedMWh: 0,
    centralProductionMWh: 0, gridboosterThermalMWh: 0, gridboosterElectricMWh: 0, dataCenterElectricMWh: 0,
    totalElectricMWh: 0, supplyTopUpMWh: 0, centralHeatCost: 0, wasteHeatCost: 0, industrialWasteHeatCost: 0, wastewaterHeatCost: 0,
    electricityCost: 0, coolingRevenue: 0,
    plantRampPenalty: 0, operatingCost: 0 };
  const boosters = new Map(), modes = { "raw-return": 0, "one-stage": 0, "two-stage": 0 }, primaryConstraintHours = {}, constraintPresentHours = {};
  for (const result of results) {
    const h = Number(result.bin.hoursPerYear);
    if (result.status === "INVALID BIN") { if (finite(h) && h > 0) totals.invalidHours += h; continue; }
    if (result.metrics.supported) totals.supportedHours += h;
    else if (result.status === "TEMPERATURE UNSUPPORTED") totals.temperatureUnsupportedHours += h;
    else if (result.status === "BRANCH TEMPERATURE CONSTRAINT") totals.branchTemperatureConstraintHours += h;
    else if (result.status === "CAPACITY SHORTFALL") totals.capacityShortfallHours += h;
    const m = result.metrics;
    modes[m.dataCenterMode] += h;
    primaryConstraintHours[m.primaryConstraint] = (primaryConstraintHours[m.primaryConstraint] ?? 0) + h;
    for (const constraint of m.constraintsPresent) constraintPresentHours[constraint] = (constraintPresentHours[constraint] ?? 0) + h;
    for (const item of m.gridBoosters) {
      if (!boosters.has(item.id)) boosters.set(item.id, { id: item.id, branchId: item.branchId, installedHours: 0, activeHours: 0,
        thermalMWh: 0, electricMWh: 0, peakThermalKW: 0, maxLiftK: 0 });
      const total = boosters.get(item.id);
      total.installedHours += h;
      if (item.thermalKW > 0) total.activeHours += h;
      total.thermalMWh += item.thermalMWh;
      total.electricMWh += item.electricMWh;
      total.peakThermalKW = Math.max(total.peakThermalKW, item.peakThermalKW);
      total.maxLiftK = Math.max(total.maxLiftK, item.maxLiftK);
    }
    if (!m.supported) continue;
    for (const [target, kw] of [["usableSupplyHeatMWh", m.usableSupplyHeatKW], ["totalWasteHeatUsedMWh", m.totalWasteHeatUsedKW],
      ["dataCenterSupplyHeatMWh", m.dataCenterSupplyHeatKW], ["industrialSupplyHeatMWh", m.industrialSupplyHeatKW],
      ["wastewaterSupplyHeatMWh", m.wastewaterSupplyHeatKW], ["greenhouseHeatUseMWh", m.greenhouseHeatUseKW],
      ["greenhouseReturnHeatMWh", m.greenhouseReturnHeatKW], ["greenhouseSupplyHeatMWh", m.greenhouseSupplyHeatKW],
      ["flexibleSinkHeatMWh", m.flexibleSinkHeatKW], ["supermarketReturnHeatMWh", m.supermarketReturnHeatKW],
      ["absorptionHeatInputMWh", m.absorptionHeatInputKW],
      ["coolingOutputMWh", m.coolingOutputKW], ["surplusHeatMWh", m.surplusHeatKW], ["curtailedHeatMWh", m.curtailedHeatKW],
      ["availableUpgradedSupplyHeatMWh", m.availableUpgradedSupplyHeatKW], ["rawReturnHeatMWh", m.rawReturnHeatKW],
      ["upgradedSupplyHeatMWh", m.upgradedSupplyHeatKW], ["otherReturnHeatMWh", m.otherReturnHeatKW],
      ["sourceHeatUsedMWh", m.sourceHeatUsedKW],
      ["centralProductionMWh", m.centralProductionKW], ["gridboosterThermalMWh", m.gridboosterThermalKW],
      ["gridboosterElectricMWh", m.gridboosterElectricKW], ["dataCenterElectricMWh", m.dataCenterElectricKW],
      ["totalElectricMWh", m.totalElectricKW], ["supplyTopUpMWh", m.supplyTopUpKW]]) totals[target] += mwh(kw, h);
    totals.centralHeatCost += m.centralHeatCostPerHour * h;
    totals.wasteHeatCost += m.wasteHeatCostPerHour * h;
    totals.industrialWasteHeatCost += m.industrialWasteHeatCostPerHour * h;
    totals.wastewaterHeatCost += m.wastewaterHeatCostPerHour * h;
    totals.electricityCost += m.electricityCostPerHour * h;
    totals.coolingRevenue += m.coolingRevenuePerHour * h;
    totals.plantRampPenalty += m.plantRampPenaltyPerHour * h;
    totals.operatingCost += m.operatingCostPerHour * h;
    for (const [sourceId, kw] of Object.entries(m.pip3BySourceKW)) {
      totals.pip3BySourceMWh[sourceId] = (totals.pip3BySourceMWh[sourceId] ?? 0) + mwh(kw, h);
    }
  }
  const hoursDelta = totalHours - 8760;
  const invalidBinHours = totals.invalidHours;
  const valid = results.filter(result => result.status !== "INVALID BIN");
  return { bins: results, totals, totalHours, hoursDelta,
    hoursWarning: hoursDelta < 0 ? { type: "missing", hours: -hoursDelta } : hoursDelta > 0 ? { type: "exceeds", hours: hoursDelta } : null,
    technicalCoverage: { supportedHours: totals.supportedHours, temperatureUnsupportedHours: totals.temperatureUnsupportedHours,
      branchTemperatureConstraintHours: totals.branchTemperatureConstraintHours,
      capacityShortfallHours: totals.capacityShortfallHours, invalidBinHours, totalHours },
    boosters: [...boosters.values()], modes, primaryConstraintHours, constraintPresentHours,
    binCostTotals: valid.reduce((sum, result) => sum + (result.metrics?.operatingCostPerHour ?? 0) * Number(result.bin.hoursPerYear), 0) };
}

export function compareAnnualProfiles(baseline, project) {
  const base = calculateAnnualProfile(baseline), next = calculateAnnualProfile(project);
  const byId = new Map(base.bins.map(result => [result.bin.id, result]));
  const matchedProjectBins = next.bins.map(result => {
    const previous = byId.get(result.bin.id);
    if (!previous) return { id: result.bin.id, project: result, comparisonAvailable: false };
    const bothSupported = previous.metrics?.supported && result.metrics?.supported;
    const hoursDiffer = Math.abs(previous.hours - result.hours) > 1e-9;
    return { id: result.bin.id, baseline: previous, project: result, comparisonAvailable: bothSupported,
      hoursDiffer, baselineHours: previous.hours, projectHours: result.hours,
      baselineUnsupportedProjectSupported: previous.status !== "SUPPORTED" && result.status === "SUPPORTED",
      directCostComparisonUnavailable: !bothSupported,
      deltas: bothSupported ? {
      additionalUsableWasteHeatMWh: mwh(result.metrics.usableSupplyHeatKW + result.metrics.returnHeatKW, result.hours)
        - mwh(previous.metrics.usableSupplyHeatKW + previous.metrics.returnHeatKW, previous.hours),
      centralProductionReductionMWh: mwh(previous.metrics.centralProductionKW, previous.hours) - mwh(result.metrics.centralProductionKW, result.hours),
      additionalElectricityMWh: mwh(result.metrics.totalElectricKW, result.hours) - mwh(previous.metrics.totalElectricKW, previous.hours),
      operatingCostSaving: previous.metrics.operatingCostPerHour * previous.hours - result.metrics.operatingCostPerHour * result.hours
      } : null };
  });
  const projectIds = new Set(next.bins.map(result => result.bin.id));
  const baselineOnly = base.bins.filter(result => !projectIds.has(result.bin.id))
    .map(result => ({ id: result.bin.id, baseline: result, comparisonAvailable: false, baselineOnly: true }));
  const matched = [...matchedProjectBins, ...baselineOnly];
  const comparable = matched.filter(item => item.comparisonAvailable);
  const operatingAssumptions = input => {
    const { outdoorTemp, ...modelInputs } = input;
    return modelInputs;
  };
  const assumptionsDiffer = matched.some(item => item.baseline && item.project
    && (JSON.stringify(operatingAssumptions(item.baseline.input)) !== JSON.stringify(operatingAssumptions(item.project.input))
      || JSON.stringify(item.baseline.prices) !== JSON.stringify(item.project.prices)));
  return { baseline: base, project: next, matched, warnings: {
    differentTotalHours: Math.abs(base.totalHours - next.totalHours) > 1e-9,
    differentBinIds: base.bins.map(item => item.bin.id).sort().join("|") !== next.bins.map(item => item.bin.id).sort().join("|"),
    assumptionsDiffer,
    binHoursDiffer: matched.filter(item => item.hoursDiffer).map(item => ({ id: item.id,
      baselineHours: item.baselineHours, projectHours: item.projectHours }))
  }, totals: comparable.reduce((sum, item) => ({
    additionalUsableWasteHeatMWh: sum.additionalUsableWasteHeatMWh + item.deltas.additionalUsableWasteHeatMWh,
    centralProductionReductionMWh: sum.centralProductionReductionMWh + item.deltas.centralProductionReductionMWh,
    additionalElectricityMWh: sum.additionalElectricityMWh + item.deltas.additionalElectricityMWh,
    operatingCostSaving: sum.operatingCostSaving + item.deltas.operatingCostSaving
  }), { additionalUsableWasteHeatMWh: 0, centralProductionReductionMWh: 0, additionalElectricityMWh: 0, operatingCostSaving: 0 }),
  comparableHours: comparable.reduce((sum, item) => sum + item.project.hours, 0),
  projectRestoresFeasibilityHours: matched.filter(item => item.baselineUnsupportedProjectSupported).reduce((sum, item) => sum + item.project.hours, 0) };
}

export function calculateBusinessCase(comparison, { capex = 0, annualFixedOM = 0, annualOtherBenefit = 0,
  analysisPeriodYears = null, discountRatePercent = null } = {}) {
  const annualNetBenefit = Number(comparison?.totals?.operatingCostSaving ?? 0) - Number(annualFixedOM || 0) + Number(annualOtherBenefit || 0);
  const hasNpvInputs = finite(analysisPeriodYears) && finite(discountRatePercent)
    && Number(analysisPeriodYears) > 0 && Number(discountRatePercent) >= 0;
  const rate = Number(discountRatePercent) / 100, years = Number(analysisPeriodYears);
  const annuity = hasNpvInputs ? rate === 0 ? years : (1 - (1 + rate) ** -years) / rate : null;
  return { annualNetBenefit, simplePaybackYears: Number(capex) > 0 && annualNetBenefit > 0 ? Number(capex) / annualNetBenefit : null,
    simplifiedNpv: hasNpvInputs ? -Number(capex || 0) + annualNetBenefit * annuity : null,
    breakEvenCapex5Year: Math.max(0, annualNetBenefit * 5), breakEvenCapex10Year: Math.max(0, annualNetBenefit * 10),
    breakEvenCapexAtDiscountRate: hasNpvInputs ? annualNetBenefit * annuity : null };
}
