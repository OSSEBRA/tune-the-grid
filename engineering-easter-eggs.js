export function isPerfectOperatingPoint({ centralHeatKW, curtailedHeatKW, feasibleBranches, branchCount }) {
  return branchCount > 0 && feasibleBranches === branchCount
    && centralHeatKW <= 4 && curtailedHeatKW <= 4;
}

export function didImproveSurplusChallenge(baseline, current) {
  return Boolean(baseline && current
    && baseline.operatingCostPerHour - current.operatingCostPerHour > 0.01
    && baseline.curtailedHeatKW - current.curtailedHeatKW > 5
    && baseline.centralHeatKW - current.centralHeatKW > 5);
}

export function captureSurplusChallengeBaseline(metrics, centralHeatKW) {
  return { operatingCostPerHour: metrics.operatingCostPerHour, curtailedHeatKW: metrics.curtailedHeatKW, centralHeatKW };
}

export function isCoolingTowerWellLoaded({ enabled, status, heatInputKW, maxHeatInputKW }) {
  return Boolean(enabled && status === "USING HEAT" && maxHeatInputKW > 0
    && heatInputKW >= maxHeatInputKW * 0.9);
}

export function shouldTriggerAmbientEgg(eligible, wasEligible, now, cooldownUntil) {
  return Boolean(eligible && !wasEligible && now >= cooldownUntil);
}

export function extremeHmpBand(value) {
  if (!Number.isFinite(Number(value))) return "";
  if (Number(value) >= 95) return "high";
  // 70 °C is the minimum valid Engineering HMP input, so use that reachable edge.
  if (Number(value) <= 70) return "low";
  return "";
}

export function isGreenhouseHealthy({ enabled, status, totalHeatKW, maxDemandKW }) {
  return Boolean(enabled && status === "USING HEAT" && maxDemandKW > 0
    && totalHeatKW > 5 && totalHeatKW >= maxDemandKW * 0.88);
}
