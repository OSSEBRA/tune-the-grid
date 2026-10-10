import { simulateNetwork, calculateTemperatureFlexSweep, summarizeNetworkFlexState, calculateOperatingCost, lowestSupportedPoint, isReturnSourceAvailableToConsumer, splitDataCenterSource } from "./network-model.js?v=20261010-1";

const $ = id => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Required network UI element #${id} is missing.`);
  return element;
};
const fmt = (value, digits = 1) => Number.isFinite(value) ? value.toLocaleString("en-GB", { maximumFractionDigits: digits, minimumFractionDigits: digits }) : "—";
const fmtTemp = value => fmt(Number(value), Number.isInteger(Number(value)) ? 0 : 1);
const displaySourceStatus = status => ({ SUPPORTED: "HMP SOURCE SUPPORTED", "TEMPERATURE UNSUPPORTED": "HMP TEMPERATURE UNSUPPORTED", "CAPACITY SHORTFALL": "SOURCE CAPACITY SHORTFALL" })[status] ?? status;
const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
const branchDefaults = [
  { id: "A", name: "Campus high-temp", demandKW: 3200, minimumSupplyTemp: 85, flowM3h: 64, lossToBranch: 1 },
  { id: "B", name: "Hospital", demandKW: 2400, minimumSupplyTemp: 78, flowM3h: 48, lossToBranch: 1.5 },
  { id: "C", name: "Campus west", demandKW: 2800, minimumSupplyTemp: 74, flowM3h: 60, lossToBranch: 1 },
  { id: "D", name: "Residential", demandKW: 1500, minimumSupplyTemp: 70, flowM3h: 36, lossToBranch: 2 },
  { id: "E", name: "Swimming pool", demandKW: 1900, minimumSupplyTemp: 76, flowM3h: 40, lossToBranch: 1.2 },
  { id: "F", name: "Low-temp homes", demandKW: 1300, minimumSupplyTemp: 68, flowM3h: 32, lossToBranch: 2 }
];
// Return Heat v1 display-only mapping; it does not imply unified customer hydraulics.
const returnConsumerBranchMap = Object.freeze({ R1: "E", R2: "F" });
const branchReturnConsumerMap = Object.freeze(Object.fromEntries(Object.entries(returnConsumerBranchMap).map(([consumerId, branchId]) => [branchId, consumerId])));
const scenarios = [
  { name: "1 — Conventional high-temperature grid", description: "At 90 °C, all six branches meet their minimums without local lift. The 60 °C data-center source is blocked after its fixed path loss; the central plant supplies the full demand.", hmp: 90, outdoor: 2, plantTemp: 98, plantPower: 15, plantAvailability: 100, plantLoss: 2, dcTemp: 60, dcPower: 2.4, dcAvailability: 85, dcLoss: 1.5, dcMode: "direct", branch: "none", mode: "target", setpoint: 85, cop: 3, capacity: 900, singleTemp: 80, singleCOP: 3, stage1Temp: 70, stage1COP: 3, stage2Temp: 85, stage2COP: 3, networkReturnTemp: 40, referenceNetworkDeltaK: null, gridBoosters: [] },
  { name: "2 — Temperature Flex / local boosting", description: "Lower the HMP to 80 °C: direct data-center heat becomes eligible and only high-temperature Branch A falls below its minimum. An installed GridBooster restores that branch locally.", hmp: 80, outdoor: 0, plantTemp: 95, plantPower: 15, plantAvailability: 100, plantLoss: 2, dcTemp: 83, dcPower: 2.4, dcAvailability: 85, dcLoss: 1.5, dcMode: "direct", branch: "A", mode: "target", setpoint: 85, cop: 3, capacity: 900, singleTemp: 80, singleCOP: 3, stage1Temp: 70, stage1COP: 3, stage2Temp: 85, stage2COP: 3, networkReturnTemp: 40, referenceNetworkDeltaK: null, gridBoosters: [{ id: "GB-1", branchId: "A", mode: "target", targetTemp: 85, liftK: 0, cop: 3, maxThermalKW: 900 }] },
  { name: "3 — Data-center two-stage heat pump", description: "The Two-stage heat pump makes the data-center source usable at the HMP, but the high-temperature Branch A still requires local temperature lift.", hmp: 82, outdoor: 4, plantTemp: 98, plantPower: 15, plantAvailability: 100, plantLoss: 2, dcTemp: 50, dcPower: 2.4, dcAvailability: 100, dcLoss: 2, dcMode: "two-stage", branch: "none", mode: "target", setpoint: 85, cop: 3, capacity: 900, singleTemp: 80, singleCOP: 3, stage1Temp: 70, stage1COP: 3, stage2Temp: 85, stage2COP: 3, networkReturnTemp: 40, referenceNetworkDeltaK: null, gridBoosters: [] },
  { name: "4 — Aggressive low-temperature grid", description: "At a very low HMP temperature, low-temperature heat becomes easy to use, but Branches A, B, C, D and E require local temperature upgrading and booster electricity becomes significant.", hmp: 70, outdoor: -4, plantTemp: 90, plantPower: 15, plantAvailability: 100, plantLoss: 2, dcTemp: 73, dcPower: 2.4, dcAvailability: 100, dcLoss: 1.5, dcMode: "direct", branch: "A", mode: "target", setpoint: 85, cop: 2.5, capacity: 2000, singleTemp: 80, singleCOP: 3, stage1Temp: 70, stage1COP: 3, stage2Temp: 85, stage2COP: 3, networkReturnTemp: 40, referenceNetworkDeltaK: null, gridBoosters: [
    { id: "GB-1", branchId: "A", mode: "target", targetTemp: 85, liftK: 0, cop: 2.5, maxThermalKW: 2000 },
    { id: "GB-2", branchId: "B", mode: "target", targetTemp: 78, liftK: 0, cop: 2.5, maxThermalKW: 2000 },
    { id: "GB-3", branchId: "C", mode: "target", targetTemp: 74, liftK: 0, cop: 2.5, maxThermalKW: 2000 },
    { id: "GB-4", branchId: "E", mode: "target", targetTemp: 76, liftK: 0, cop: 2.5, maxThermalKW: 2000 },
    { id: "GB-5", branchId: "D", mode: "target", targetTemp: 70, liftK: 0, cop: 2.5, maxThermalKW: 2000 }
  ] },
  { ...{
    name: "5 — RETURN HEAT NETWORK",
    description: "Follow a 43 °C return line toward the plant. R1 sits upstream of the data-center return injection and cannot use it; downstream R2 can recover its heat and cool the return before it reaches the plant.",
    hmp: 90, outdoor: 2, plantTemp: 98, plantPower: 15, plantAvailability: 100, plantLoss: 2, dcTemp: 60, dcPower: 2.4, dcAvailability: 85, dcLoss: 1.5, dcMode: "direct", branch: "none", mode: "target", setpoint: 85, cop: 3, capacity: 900, singleTemp: 80, singleCOP: 3, stage1Temp: 70, stage1COP: 3, stage2Temp: 85, stage2COP: 3, networkReturnTemp: 43, referenceNetworkDeltaK: null, gridBoosters: []
  }, returnHeatDemo: true, upstreamR1: true, dcSupplyAllocationMW: 0, dcReturnAllocationMW: 1.2 },
  { ...{
    name: "6 — MULTI-LEVEL WASTE HEAT NETWORK",
    description: "The same data-center source splits between HMP upgrading and raw return injection. A supermarket adds independent return-only heat; R1 and R2 recover suitable heat downstream.",
    hmp: 90, outdoor: 2, plantTemp: 98, plantPower: 15, plantAvailability: 100, plantLoss: 2, dcTemp: 60, dcPower: 2.4, dcAvailability: 100, dcLoss: 1.5, dcMode: "two-stage", branch: "none", mode: "target", setpoint: 85, cop: 3, capacity: 900, singleTemp: 80, singleCOP: 3, stage1Temp: 70, stage1COP: 3, stage2Temp: 95, stage2COP: 3, networkReturnTemp: 43, referenceNetworkDeltaK: null, gridBoosters: []
  }, returnHeatDemo: true, multiLevelWasteHeatDemo: true, dcSupplyAllocationMW: 1.2, dcReturnAllocationMW: 1.2, supermarketEnabled: true, supermarketSourceTempC: 48, r2MinimumTemp: 45 }
];
const branchControls = $("branch-controls");
const scenarioSelect = $("scenario-select");
const branchInputs = new Map();
let gridBoosters = [];
let nextBoosterId = 1;
let comparisonTargets = [75, 80, 82, 85];
const set = (id, value) => { $(id).textContent = value; };
const svgNode = (svg, tag, attrs = {}, text = "") => {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  if (text) node.textContent = text;
  svg.append(node);
  return node;
};
const branchSelector = selected => `<select data-booster-id="${selected.id}" data-booster-key="branchId" aria-label="Place ${selected.id} on a branch"><option value="">Unplaced</option>${branchDefaults.map(b => `<option value="${b.id}" ${selected.branchId === b.id ? "selected" : ""}>Branch ${b.id}</option>`).join("")}</select>`;

function assignBoosterBranch(item, branchId) {
  item.branchId = branchId;
  if (document.body.dataset.mode === "casual" && branchId) {
    const branch = branchDefaults.find(candidate => candidate.id === branchId);
    const minimumInput = branchControls.querySelectorAll("input").find(input => input.dataset.branch === branchId && input.dataset.key === "minimumSupplyTemp");
    if (branch) { item.mode = "target"; item.targetTemp = Number(minimumInput?.value ?? branch.minimumSupplyTemp); }
  }
}

for (const branch of branchDefaults) {
  const card = document.createElement("div");
  card.className = "branch-input-card";
  card.innerHTML = `<div class="branch-input-title"><b>BRANCH ${branch.id}</b><span>customer path</span></div>
    <label>Branch name <span class="branch-input-wrap"><input data-branch="${branch.id}" data-key="name" type="text" value="${branch.name}"></span></label>
    <label>Heat demand <span class="branch-input-wrap"><input data-branch="${branch.id}" data-key="demandKW" type="number" min="0" step="any" value="${branch.demandKW}"><b>kWth</b></span></label>
    <label>Minimum supply <span class="branch-input-wrap"><input data-branch="${branch.id}" data-key="minimumSupplyTemp" type="number" step="any" value="${branch.minimumSupplyTemp}"><b>°C</b></span></label>
    <label>Branch flow <span class="branch-input-wrap"><input data-branch="${branch.id}" data-key="flowM3h" type="number" min="0" step="any" value="${branch.flowM3h}"><b>m³/h</b></span></label>
    <label>HMP → branch ΔT loss <span class="branch-input-wrap"><input data-branch="${branch.id}" data-key="lossToBranch" type="number" min="0" step="any" value="${branch.lossToBranch}"><b>K</b></span></label>
    <details class="branch-advanced"><summary>Optional branch return</summary><label>Branch return temperature <span class="branch-input-wrap"><input data-branch="${branch.id}" data-key="returnTemp" type="number" step="any" placeholder="—"><b>°C</b></span></label></details>`;
  branchControls.append(card);
}
for (const [index, scenario] of scenarios.entries()) {
  const option = document.createElement("option");
  option.value = String(index); option.textContent = scenario.name; scenarioSelect.append(option);
}

function readScenario() {
  const get = id => $(id).value;
  const values = branchControls.querySelectorAll("input");
  const scenarioBranches = branchDefaults.map(branch => {
    const fields = Object.fromEntries([...values].filter(input => input.dataset.branch === branch.id).map(input => [input.dataset.key, input.value]));
    return { ...branch, ...fields, returnTemp: fields.returnTemp === "" || fields.returnTemp == null ? null : Number(fields.returnTemp) };
  });
  const target = get("booster-mode") === "target";
  const dataCenterRouting = splitDataCenterSource({ availableMW: get("dc-power"), supplyMW: get("dc-supply-allocation"), returnMW: get("dc-return-allocation"), availabilityPercent: get("dc-availability") });
  const returnNetwork = { baseReturnTempC: get("return-base-temp"), returnFlowM3h: get("return-flow"), nodes: [
    { id: "R1", name: "R1 Greenhouse", type: "THREE_PIPE_CONSUMER", order: get("r1-order"), enabled: true, demandKW: get("r1-demand"), minimumUsableTempC: get("r1-min-temp"), maxUptakeKW: get("r1-max-uptake") },
    // DC-RETURN is the return path of the same source whose supply share is passed to the HMP model below.
    { id: "DC-RETURN", sourceGroupId: dataCenterRouting.sourceId, name: "DATA CENTER RETURN", type: "WASTE_HEAT_SOURCE", returnOnly: true, order: get("dc-return-order"), enabled: dataCenterRouting.returnMW > 0, sourceTempC: get("dc-temp"), availableKW: dataCenterRouting.returnMW * 1000 * dataCenterRouting.availabilityPercent / 100, maxInjectionKW: get("dc-return-max-injection") },
    { id: "SM-1", name: "SUPERMARKET", type: "WASTE_HEAT_SOURCE", returnOnly: true, order: get("sm-order"), enabled: get("sm-enabled") === "true", sourceTempC: get("sm-temp"), availableKW: get("sm-power"), maxInjectionKW: get("sm-max-injection") },
    { id: "R2", name: "R2 Low-temp buildings", type: "THREE_PIPE_CONSUMER", order: get("r2-order"), enabled: true, demandKW: get("r2-demand"), minimumUsableTempC: get("r2-min-temp"), maxUptakeKW: get("r2-max-uptake") },
    { id: "PLANT", name: "Central plant", type: "CENTRAL_PLANT", order: 100 }
  ] };
  return {
    hmpTargetTemp: get("hmp-target"), outdoorTemp: get("outdoor-temp"), networkReturnTemp: get("network-return-temp"),
    referenceNetworkDeltaK: get("network-reference-delta") === "" ? null : get("network-reference-delta"), branches: scenarioBranches,
    sourceTemperatureStrategy: document.body.dataset.mode === "engineer" ? get("source-temperature-strategy") : "strict", normalPlantSupplyTemp: get("normal-plant-supply"),
    maxRampedPlantSupplyTemp: get("max-ramped-plant-supply"), plantRampCostPerMWhPerK: get("plant-ramp-cost"),
    centralPlant: { supplyTemp: get("plant-temp"), maxPowerMW: get("plant-power"), availabilityPercent: get("plant-availability"), lossToHMP: get("plant-loss") },
    wasteHeat: { injectionTemp: get("dc-temp"), maxPowerMW: dataCenterRouting.supplyMW, availabilityPercent: get("dc-availability"), lossToHMP: get("dc-loss"),
      mode: get("dc-mode"), singleStageOutletTemp: get("dc-single-temp"), singleStageCOP: get("dc-single-cop"),
      stage1OutletTemp: get("dc-stage1-temp"), stage1COP: get("dc-stage1-cop"), stage2OutletTemp: get("dc-stage2-temp"), stage2COP: get("dc-stage2-cop") },
    dataCenterRouting, returnNetwork,
    booster: { branchId: get("booster-branch"), mode: target ? "target" : "lift", targetTemp: target ? get("booster-setpoint") : 0,
      liftK: target ? 0 : get("booster-setpoint"), cop: get("network-cop"), maxThermalKW: get("booster-capacity") }, gridBoosters
  };
}

function classify(branch) {
  if (branch.boosterActive) return branch.finalMargin >= 0 ? ["boosted", "⚡ BOOSTER ACTIVE · FEASIBLE"] : ["boosted-below", "⚡ BOOSTER ACTIVE · BELOW MINIMUM"];
  if (branch.status === "unavailable") return ["below", "! HMP TEMPERATURE UNAVAILABLE"];
  if (branch.status === "below") return ["below", "! BELOW MINIMUM"];
  if (branch.status === "close") return ["close", "◇ CLOSE TO LIMIT"];
  return ["feasible", "✓ FEASIBLE"];
}

function renderBoosterTray() {
  const host = $("gridbooster-tray"); host.replaceChildren();
  if (!gridBoosters.length) { host.innerHTML = `<p class="booster-tray-empty">No GridBoosters yet. Add one, then drag it onto a branch pipe.</p>`; return; }
  for (const item of gridBoosters) {
    const card = document.createElement("article");
    card.className = `gridbooster-token${item.branchId ? " placed" : ""}`;
    card.draggable = true; card.dataset.boosterId = item.id;
    const value = item.mode === "target" ? item.targetTemp : item.liftK;
    const casual = document.body.dataset.mode === "casual";
    card.innerHTML = `<header><span>⚡</span><b>${item.id}</b><button type="button" data-booster-remove="${item.id}" aria-label="Remove ${item.id}">×</button></header>
      <label>Place ${branchSelector(item)}</label>
      ${casual ? `<p class="auto-boost-note">AUTO BOOST · Target: branch minimum ${item.branchId ? `${fmtTemp(value)}°C` : "set when placed"}</p>` : `<label>${item.mode === "target" ? "Target outlet" : "Requested lift"}<span class="booster-token-input"><input data-booster-id="${item.id}" data-booster-key="${item.mode === "target" ? "targetTemp" : "liftK"}" type="number" step="any" value="${value}"><b>${item.mode === "target" ? "°C" : "K"}</b></span></label>
      <label>Heating COP<span class="booster-token-input"><input data-booster-id="${item.id}" data-booster-key="cop" type="number" min="1.01" step="any" value="${item.cop}"><b>—</b></span></label>
      <label>Max thermal power<span class="booster-token-input"><input data-booster-id="${item.id}" data-booster-key="maxThermalKW" type="number" min="0" step="any" value="${item.maxThermalKW}"><b>kWth</b></span></label>`}`;
    host.append(card);
  }
  for (const token of host.querySelectorAll(".gridbooster-token")) token.addEventListener("dragstart", event => {
    event.dataTransfer?.setData("text/plain", token.dataset.boosterId);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
  });
  host.querySelectorAll("[data-booster-remove]").forEach(button => button.addEventListener("click", () => {
    gridBoosters = gridBoosters.filter(item => item.id !== button.dataset.boosterRemove); renderBoosterTray(); recalculate();
  }));
  host.querySelectorAll("[data-booster-id][data-booster-key]").forEach(input => {
    const eventType = input.tagName === "SELECT" ? "change" : "input";
    input.addEventListener(eventType, () => {
      const item = gridBoosters.find(candidate => candidate.id === input.dataset.boosterId);
      if (!item) return;
      const key = input.dataset.boosterKey;
      if (key === "branchId") assignBoosterBranch(item, input.value); else item[key] = Number(input.value);
      if (key === "branchId") { renderBoosterTray(); }
      recalculate();
    });
  });
}

function renderBranches(result) {
  const hosts = { top: $("network-branches-top"), bottom: $("network-branches-bottom") };
  Object.values(hosts).forEach(host => host.replaceChildren());
  for (const branch of result.afterBranches) {
    const [status, label] = classify(branch);
    const selected = $("booster-branch").value === branch.id || branch.gridBoosters.length > 0;
    const row = document.createElement("article");
    row.className = `network-branch-row ${status}${selected ? " selected" : ""}${!branch.feasibleWithoutBooster ? " needs-booster" : ""}`;
    row.dataset.branch = branch.id;
    const boosters = branch.gridBoosters.map(item => `<div class="branch-booster-station" draggable="true" data-booster-id="${item.id}"><span>⚡</span><b>${item.id} · GRIDBOOSTER</b><small>IN ${fmt(item.inletTemp)}°C → OUT ${fmt(item.outletTemp)}°C</small><small>LIFT +${fmt(item.actualLiftK)} K · ${fmt(item.thermalPowerKW)} kWth</small><small>ELECTRIC ${fmt(item.electricalPowerKW)} kWe · COP ${fmt(item.cop, 2)}</small><small>MAX ${fmt(item.maxThermalKW)} kWth · ${item.capacitySufficient ? "✓ CAPACITY OK" : `! UNDERSIZED · ${fmt(item.requestedPowerKW - item.thermalPowerKW)} kWth short`}</small>${branch.feasibleWithoutBooster ? `<small class="booster-note">Booster installed — branch already feasible without local lift.</small>` : ""}</div>`).join("");
    const duty = branch.boosterActive ? `ACTUAL LOCAL DUTY ${fmt(branch.boosterThermalPowerKW)} kWth · ${fmt(branch.boosterElectricalPowerKW)} kWe` : `REQUIRED / HYPOTHETICAL DUTY ${fmt(branch.requiredBoosterPowerKW)} kWth`;
    row.innerHTML = `<div class="branch-pipe-connector"><span>${branch.id <= "C" ? "▲" : "▼"}</span></div><div class="branch-route-card">
      <div class="branch-route-head"><b class="branch-flag">${branch.id}</b><strong>${escapeHtml(branch.name).toUpperCase()} · CUSTOMER LOAD</strong><span class="branch-status">${label}</span>${selected ? `<span class="selected-tag">★ ${branch.gridBoosters.length ? "BOOSTER PLACED" : "SELECTED PATH"}</span>` : ""}</div>
      <div class="branch-route-values"><b class="branch-temp">TEMP CAPABILITY ${fmt(branch.availableSupplyTemp)}°C</b><span>MIN ${fmt(branch.minimumSupplyTemp)}°C</span><span>LOAD ${fmt(branch.demandKW / 1000, 2)} MWth</span><span>FLOW ${fmt(branch.flowM3h)} m³/h</span><span>HMP → BRANCH ΔT LOSS −${fmt(branch.lossToBranch)} K</span><span>CAPABILITY MARGIN ${fmt(branch.margin)} K</span><span>WITHOUT BOOSTER ${branch.feasibleWithoutBooster ? "✓ TEMP CAPABLE" : "! BELOW MINIMUM"}</span><span>${duty}</span></div>
      <div class="branch-drop-hint">DROP GRIDBOOSTER HERE · BASE CAPABILITY ${fmt(branch.availableSupplyTemp)}°C → BOOSTED CAPABILITY ${fmt(branch.finalSupplyTemp)}°C · MARGIN ${fmt(branch.finalMargin)} K</div>
    </div>${boosters}`;
    row.addEventListener("dragover", event => { event.preventDefault(); row.classList.add("drag-target"); });
    row.addEventListener("dragleave", () => row.classList.remove("drag-target"));
    row.addEventListener("drop", event => {
      event.preventDefault(); row.classList.remove("drag-target");
      const id = event.dataTransfer?.getData("text/plain");
      const item = gridBoosters.find(candidate => candidate.id === id);
      if (item) { assignBoosterBranch(item, branch.id); renderBoosterTray(); recalculate(); }
    });
    row.querySelectorAll("[data-booster-id]").forEach(token => token.addEventListener("dragstart", event => event.dataTransfer?.setData("text/plain", token.dataset.boosterId)));
    hosts[branch.id <= "C" ? "top" : "bottom"].append(row);
  }
}

function renderProfile(result) {
  const svg = $("temperature-profile"); svg.replaceChildren();
  const points = [
    { label: "Plant", fullLabel: "Central heat plant contribution at HMP", temp: result.centralPlant.contributionTemp, source: true },
    { label: "DC", fullLabel: "Data-center path contribution after connection loss", temp: result.wasteHeat.contributionTemp, source: true },
    { label: "HMP", fullLabel: "HMP target and temperature capability", temp: result.hmpTemperatureCapabilityTemp, minimum: result.hmpTargetTemp },
    ...result.afterBranches.map(branch => ({ label: branch.id, fullLabel: `Branch ${branch.id}: ${branch.name}`, temp: branch.finalSupplyTemp, minimum: branch.minimumSupplyTemp, status: branch.finalStatus }))
  ].filter(point => Number.isFinite(point.temp));
  if (points.length < 2) return;
  const left = 58, right = 620, top = 20, bottom = 156;
  const low = Math.min(...points.map(point => Math.min(point.temp, point.minimum ?? point.temp))) - 4;
  const high = Math.max(...points.map(point => Math.max(point.temp, point.minimum ?? point.temp))) + 4;
  const x = index => left + (right - left) * index / (points.length - 1);
  const y = temp => bottom - (temp - low) / Math.max(high - low, 1) * (bottom - top);
  for (let i = 0; i <= 4; i++) { const value = high - (high - low) * i / 4, yy = y(value); svgNode(svg, "line", { x1: left, x2: right, y1: yy, y2: yy, class: "profile-grid" }); svgNode(svg, "text", { x: left - 8, y: yy + 4, "text-anchor": "end", class: "profile-axis" }, `${fmt(value, 0)}°`); }
  svgNode(svg, "polyline", { points: points.slice(2).map((point, index) => `${x(index + 2)},${y(point.temp)}`).join(" "), class: "profile-line" });
  points.forEach((point, index) => {
    const color = point.source ? (index === 0 ? "#d99128" : "#47a96a") : point.status === "below" || point.status === "boosted-below" ? "#e64c42" : point.status === "close" ? "#dd9b14" : point.status === "boosted" ? "#279c5e" : "#218fc1";
    if (point.minimum != null) svgNode(svg, "line", { x1: x(index) - 8, x2: x(index) + 8, y1: y(point.minimum), y2: y(point.minimum), class: "profile-minimum" });
    svgNode(svg, "circle", { cx: x(index), cy: y(point.temp), r: 6, fill: color, class: "profile-point" });
    const label = svgNode(svg, "text", { x: x(index), y: 172, "text-anchor": "middle", class: "profile-label", "aria-label": point.fullLabel });
    svgNode(label, "title", {}, point.fullLabel);
    svgNode(label, "tspan", { x: x(index), dy: 0 }, point.label);
    svgNode(svg, "text", { x: x(index), y: y(point.temp) - 10, "text-anchor": "middle", class: "profile-value" }, `${fmt(point.temp)}°`);
  });
}

function renderBranchComparison(result) {
  const host = $("branch-comparison"); host.replaceChildren();
  const allTemps = result.afterBranches.flatMap(branch => [branch.finalSupplyTemp, branch.minimumSupplyTemp]).filter(Number.isFinite);
  const low = Math.min(...allTemps), high = Math.max(...allTemps), span = Math.max(high - low, 1);
  for (const branch of result.afterBranches) {
    const [status, label] = classify(branch), row = document.createElement("div"); row.className = `comparison-branch ${status}`;
    const availablePosition = Math.max(0, Math.min(100, (branch.finalSupplyTemp - low) / span * 100));
    const minimumPosition = Math.max(0, Math.min(100, (branch.minimumSupplyTemp - low) / span * 100));
    row.innerHTML = `<div class="comparison-branch-head"><b>${branch.id}</b><span>${label}</span><strong>${fmt(branch.finalMargin)} K</strong></div>
      <div class="temperature-bar"><i class="available-bar" style="width:${availablePosition}%"></i><b class="minimum-marker" style="left:${minimumPosition}%"></b></div>
      <small>Temperature capability ${fmt(branch.finalSupplyTemp)}°C <i>·</i> Minimum ${fmt(branch.minimumSupplyTemp)}°C <i>·</i> HMP-to-branch loss −${fmt(branch.lossToBranch)} K <i>·</i> Demand ${fmt(branch.demandKW / 1000, 2)} MWth <i>·</i> Flow ${fmt(branch.flowM3h)} m³/h <i>·</i> ${branch.boosterActive ? `Booster duty ${fmt(branch.boosterThermalPowerKW)} kWth / ${fmt(branch.boosterElectricalPowerKW)} kWe` : `Required / hypothetical booster duty ${fmt(branch.requiredBoosterPowerKW)} kWth`}</small>`;
    host.append(row);
  }
}

function renderEnergy(result) {
  const total = result.totalDemandKW, waste = result.wasteHeatUsedKW, unserved = result.hmpPowerShortfallKW;
  set("energy-caption", `${fmt(total / 1000, 2)} MW total customer heat demand`);
  const host = $("energy-split"); host.replaceChildren();
  for (const [label, value, cls] of [["Central plant", result.centralPlantUsedKW, "central-energy"], ["Data-center path heat injected", waste, "waste-energy"], ["Unserved thermal requirement", unserved, "unserved-energy"]]) {
    const share = total > 0 ? value / total * 100 : 0, row = document.createElement("div"); row.className = `energy-row ${cls}`;
    row.innerHTML = `<div><b>${label}</b><span>${fmt(value / 1000, 2)} MW · ${fmt(share, 1)}%</span></div><div class="energy-track"><i class="${cls}" style="width:${Math.min(100, share)}%"></i></div>`; host.append(row);
  }
}

function renderSystemSummary(result, input) {
  const after = result.withBooster, source = after.wasteHeat, plant = after.centralPlant;
  const prices = flexPrices(), metrics = summarizeNetworkFlexState(result, input, prices), demand = after.totalDemandKW;
  const share = power => demand > 0 ? `${fmt(power / demand * 100, 1)}%` : "—";
  const pathNames = { direct: "Direct waste heat", "one-stage": "One-stage heat pump", "two-stage": "Two-stage heat pump" };
  const status = after.networkOperatingPointSupported ? "HMP SOURCE SUPPORTED" : after.hmpTemperatureReachable ? "SOURCE CAPACITY SHORTFALL" : "HMP TEMPERATURE UNSUPPORTED";
  const sourceUsed = after.dataCenterSourceHeatUsedKW, sourceAvailable = source.availableKW;
  const utilization = sourceAvailable > 0 ? sourceUsed / sourceAvailable * 100 : 0;
  const centralCost = calculateOperatingCost({ centralPlantKW: after.centralPlantUsedKW }, prices);
  const rawHeatCost = calculateOperatingCost({ wasteHeatKW: sourceUsed }, prices);
  const hpElectricCost = calculateOperatingCost({ electricPowerKW: after.dataCenterElectricPowerKW }, prices);
  const boosterElectricCost = calculateOperatingCost({ electricPowerKW: after.booster.electricalPowerKW }, prices);

  set("kpi-hmp-target", `${fmtTemp(after.hmpTargetTemp)}°C`);
  set("kpi-hmp", `${fmtTemp(after.hmpTargetTemp)}°C`);
  set("kpi-waste-share", share(after.wasteHeatUsedKW));
  set("kpi-central-share", share(after.centralPlantUsedKW));
  set("kpi-branch-lift", String(after.branchesNeedingBooster));
  set("kpi-electricity", `${fmt(metrics.totalSystemElectricKW)} kWe`);
  set("kpi-cost", `${fmt(metrics.operatingCostPerHour, 2)} €/h`);

  set("result-hmp", fmtTemp(after.hmpTargetTemp));
  set("result-hmp-capability", fmtTemp(after.hmpTemperatureCapabilityTemp));
  set("summary-hmp-capability-label", after.sourceBlending?.selected ? "Simplified mixed supply estimate" : "Temperature capability");
  set("result-hmp-state", status);
  set("summary-return-temp", fmtTemp(after.networkReturnTemp));
  set("summary-network-delta", fmt(after.networkDeltaK, 1));
  set("return-hmp-supply", `${fmtTemp(after.hmpTargetTemp)} °C`);
  set("return-network-temp", `${fmtTemp(after.networkReturnTemp)} °C`);
  set("return-network-delta", `${fmt(after.networkDeltaK, 1)} K`);
  set("summary-return-note", after.referenceNetworkDeltaK == null ? "Simplified return reference · no return mixing modeled" : `Reference ΔT ${fmt(after.referenceNetworkDeltaK, 1)} K · difference ${fmt(after.networkDeltaK - after.referenceNetworkDeltaK, 1)} K`);
  set("return-reference-status", after.referenceNetworkDeltaK == null ? "Simplified return-temperature reference; no mixed return temperature is calculated." : `Reference ΔT ${fmt(after.referenceNetworkDeltaK, 1)} K · calculated supply-return span differs by ${fmt(after.networkDeltaK - after.referenceNetworkDeltaK, 1)} K.`);

  set("result-central", fmt(after.centralProductionKW / 1000, 2));
  set("result-plant-used", fmt(after.centralPlantUsedKW / 1000, 2));
  set("summary-central-available", fmt(plant.usableKW / 1000, 2));
  set("summary-central-share", share(after.centralPlantUsedKW));
  set("result-plant-shortfall", fmt(after.centralPlantShortfallKW / 1000, 2));

  set("result-waste-available", fmt(sourceAvailable / 1000, 2));
  set("result-waste-usable", fmt(after.wasteHeatUsedKW / 1000, 2));
  set("result-waste-eligibility", source.usedViaBlending ? "STRICTLY BLOCKED · USED VIA BLENDING" : (source.strictTemperatureEligible ?? source.injectionEligible) ? "STRICTLY ELIGIBLE" : "STRICTLY BLOCKED");
  set("summary-selected-path", pathNames[source.mode]);
  set("summary-source-used", fmt(sourceUsed / 1000, 2));
  set("summary-source-utilization", `${fmt(utilization, 1)}%`);
  set("summary-hp-output", fmt(source.deliveredHeatKW / 1000, 2));
  set("summary-hp-electric", fmt(after.dataCenterElectricPowerKW));
  set("summary-source-limited", source.injectionEligible && source.deliveredHeatKW < demand ? "YES" : "NO");
  set("summary-temperature-limited", source.injectionEligible ? "NO" : "YES");
  set("summary-central-share", share(after.centralPlantUsedKW));
  set("result-feasible-without", String(after.feasibleCount));
  set("result-needs-booster", String(after.branchesNeedingBooster));
  set("result-feasible", String(after.feasibleAfterCount));
  set("result-critical", String(after.criticalAfterCount));
  set("summary-booster-count", String(after.booster.installedCount));
  set("result-booster-thermal", fmt(after.booster.thermalPowerKW));
  set("result-booster-electric", fmt(after.booster.electricalPowerKW));
  set("result-booster-capacity", `${after.booster.capacitySufficient ? "CAPACITY OK" : "ONE OR MORE UNDERSIZED"} · ${fmt(after.booster.capacityKW)} kWth total maximum`);
  set("summary-hypothetical-duty", fmt(metrics.additionalRequiredBoosterThermalKW));
  set("summary-hypothetical-electric", fmt(metrics.additionalRequiredBoosterElectricKW));
  set("summary-hp-electric-total", fmt(after.dataCenterElectricPowerKW));
  set("summary-gb-electric-total", fmt(after.booster.electricalPowerKW));
  set("summary-total-electric", fmt(metrics.totalSystemElectricKW));
  set("summary-operating-cost", fmt(metrics.operatingCostPerHour, 2));
  set("cost-central-breakdown", `${fmt(centralCost, 2)} €/h`);
  set("cost-waste-breakdown", `${fmt(rawHeatCost, 2)} €/h`);
  set("cost-hp-breakdown", `${fmt(hpElectricCost, 2)} €/h`);
  set("cost-booster-breakdown", `${fmt(boosterElectricCost, 2)} €/h`);
  set("cost-ramp-breakdown", `${fmt(metrics.plantRampPenaltyPerHour, 2)} €/h`);
  set("cost-total-breakdown", `${fmt(metrics.operatingCostPerHour, 2)} €/h`);
  set("balance-demand", `${fmt(demand / 1000, 2)} MWth`);
  set("balance-central", `${fmt(after.centralPlantUsedKW / 1000, 2)} MWth`);
  set("balance-data-center", `${fmt(after.wasteHeatUsedKW / 1000, 2)} MWth`);
  set("balance-unserved", `${fmt(after.hmpPowerShortfallKW / 1000, 2)} MWth`);
  $("balance-unserved-plus").hidden = after.hmpPowerShortfallKW <= 1e-9;
  $("balance-unserved-item").hidden = after.hmpPowerShortfallKW <= 1e-9;
  set("balance-booster-thermal", fmt(after.booster.thermalPowerKW, 1));
  set("balance-booster-electric", fmt(after.booster.electricalPowerKW, 1));
  $("normal-cost-electric-power").textContent = fmt(metrics.totalSystemElectricKW);
  $("normal-cost-central").textContent = `${fmt(centralCost, 2)} €/h`;
  $("normal-cost-electric").textContent = `${fmt(calculateOperatingCost({ electricPowerKW: metrics.totalSystemElectricKW }, prices), 2)} €/h`;
  $("normal-cost-waste").textContent = `${fmt(rawHeatCost, 2)} €/h`;
  $("normal-cost-total").textContent = `${fmt(metrics.operatingCostPerHour, 2)} €/h`;

  const branchReturns = after.afterBranches.filter(branch => branch.returnTemp != null);
  const branchDiagnostics = $("branch-return-diagnostics");
  branchDiagnostics.hidden = !branchReturns.length;
  branchDiagnostics.textContent = branchReturns.map(branch => {
    const check = branch.branchReturnDiagnostic;
    return `Branch ${branch.id}: ${fmtTemp(branch.finalSupplyTemp)}°C supply − ${fmtTemp(branch.returnTemp)}°C return = ${fmt(branch.branchDeltaK, 1)} K · Entered heat demand: ${fmt(branch.demandKW / 1000, 2)} MWth · Flow/ΔT implied heat: ${fmt((check?.impliedHeatKW ?? 0) / 1000, 2)} MWth · Difference: ${check?.differencePercent == null ? "—" : `${fmt(check.differencePercent, 1)}%`} · ${check?.status ?? "CHECK INPUTS"}`;
  }).join(" · ");
  renderSourceBlending(after);
  const mode = $("dc-mode").value;
  const casualAssumption = $("casual-hp-assumption");
  casualAssumption.hidden = document.body.dataset.mode !== "casual" || mode === "direct";
  casualAssumption.textContent = mode === "one-stage"
    ? `Using demo assumptions: Outlet ${fmtTemp($("dc-single-temp").value)} °C · COP ${fmt(Number($("dc-single-cop").value), 1)}`
    : `Using demo assumptions: Stage 1 ${fmtTemp($("dc-stage1-temp").value)} °C · COP ${fmt(Number($("dc-stage1-cop").value), 1)}; Stage 2 ${fmtTemp($("dc-stage2-temp").value)} °C · COP ${fmt(Number($("dc-stage2-cop").value), 1)}`;
}

function renderSourceBlending(state) {
  const host = $("source-blending-diagnostics"), blend = state.sourceBlending;
  if (document.getElementById("source-temperature-strategy")?.value !== "blended") { host.textContent = "Strict temperature eligibility is active."; return; }
  if (!blend?.selected) {
    host.textContent = `${blend?.status ?? "BLENDING NOT AVAILABLE"} · strict baseline ${fmt(blend?.strictCostPerHour, 2)} €/h${Number.isFinite(blend?.blendedCostPerHour) ? ` · best blended/ramped ${fmt(blend.blendedCostPerHour, 2)} €/h · difference ${fmt(blend.differencePerHour, 2)} €/h` : ""} · strict ${blend?.strictFeasible ? "FEASIBLE" : "INFEASIBLE"} · blended ${blend?.blendedFeasible ? "FEASIBLE" : "INFEASIBLE"}`;
    return;
  }
  host.textContent = `Available data-center heat ${fmt(blend.availableDataCenterHeatKW / 1000, 2)} MWth · selected ${fmt(blend.selectedDataCenterHeatKW / 1000, 2)} MWth (${fmt(blend.dataCenterSourceUtilizationPercent, 1)}%) · Plant contribution ${fmt(blend.plantContributionTemp)}°C at HMP · data-center contribution ${fmt(blend.dataCenterContributionTemp)}°C at HMP · plant ${fmt(blend.plantThermalKW / 1000, 2)} MWth / ${fmt(blend.plantFlowM3h)} m³/h · data center ${fmt(blend.dataCenterThermalKW / 1000, 2)} MWth / ${fmt(blend.dataCenterFlowM3h)} m³/h · mixed ${fmt(blend.mixedSupplyTemp)}°C vs HMP target ${fmt(blend.hmpTargetTemp)}°C · required plant outlet ${fmt(blend.requiredPlantSupplyTemp)}°C · ramp +${fmt(blend.plantRampK)} K · ramp limit ${fmt(blend.rampLimitSupplyTemp)}°C · strict ${fmt(blend.strictCostPerHour, 2)} €/h · blended ${fmt(blend.blendedCostPerHour, 2)} €/h · difference ${fmt(blend.differencePerHour, 2)} €/h · ramp penalty ${fmt(blend.rampPenaltyPerHour, 2)} €/h · ${blend.status}`;
}

function renderDataCenterModes(result) {
  const after = result.withBooster;
  const host = $("data-center-mode-comparison"); host.replaceChildren();
  const prices = flexPrices();
  for (const [key, title] of [["direct", "DIRECT WASTE HEAT"], ["one-stage", "ONE-STAGE HEAT PUMP"], ["two-stage", "TWO-STAGE HEAT PUMP"]]) {
    const mode = after.sourceBlending?.selected && after.wasteHeat.mode === key ? after.wasteHeat : after.dataCenterModes[key], card = document.createElement("article");
    const strictEligible = mode.strictTemperatureEligible ?? mode.injectionEligible;
    const blendedAccepted = after.sourceBlending?.selected && after.wasteHeat.mode === key && mode.usedViaBlending;
    card.className = `dc-mode-card ${strictEligible || blendedAccepted ? "injectable" : "blocked"}${after.wasteHeat.mode === key ? " active" : ""}`;
    const status = blendedAccepted ? `STRICTLY BLOCKED · USED VIA BLENDED SOURCE OPERATION · ${fmt(mode.injectedKW)} kWth INJECTED`
      : strictEligible ? `✓ ${fmt(mode.contributionTemp)}°C AFTER LOSS > ${fmt(after.hmpTargetTemp)}°C HMP · ${fmt(mode.injectedKW)} kWth INJECTED`
        : `⛔ ${fmt(mode.contributionTemp)}°C AFTER LOSS ≤ ${fmt(after.hmpTargetTemp)}°C HMP · STRICTLY BLOCKED`;
    const stageRows = mode.stages.map((stage, index) => `<div><span>Stage ${index + 1} · ${fmt(stage.outletTemp)}°C</span><b>Source ${fmt(stage.sourceHeatKW)} kWth + electric ${fmt(stage.electricalPowerKW)} kWe = ${fmt(stage.deliveredHeatKW)} kWth</b></div>${stage.noUpgradeRequired ? `<small class="dc-no-upgrade">NO UPGRADE REQUIRED · ${fmt(stage.inletTemp)}°C source already meets the ${fmt(stage.requestedOutletTemp)}°C target.</small>` : ""}`).join("");
    const operatingCost = calculateOperatingCost({ wasteHeatKW: mode.sourceHeatKW, electricPowerKW: mode.electricalPowerKW }, prices);
    const deliveredHeatCost = mode.deliveredHeatKW > 0 ? operatingCost / (mode.deliveredHeatKW / 1000) : null;
    card.innerHTML = `<header><b>${title}</b><span>${after.wasteHeat.mode === key ? "SELECTED MODE" : "COMPARE"}</span></header><strong class="dc-mode-status">${status}</strong>${key !== "direct" && mode.noUpgradeRequired ? `<p class="dc-no-upgrade">NO UPGRADE REQUIRED · Source temperature already meets the requested heat-pump outlet target.</p>` : ""}<div class="dc-mode-values"><div><span>Outlet before loss</span><b>${fmt(mode.outletTemp)}°C</b></div><div><span>Delivered at HMP</span><b>${fmt(mode.contributionTemp)}°C</b></div><div><span>Connection loss</span><b>−${fmt(mode.lossToHMP)} K</b></div><div><span>Raw source heat</span><b>${fmt(mode.sourceHeatKW)} kWth</b></div>${stageRows}<div><span>Electric input</span><b>${fmt(mode.electricalPowerKW)} kWe</b></div><div><span>Heat-pump delivered heat</span><b>${fmt(mode.deliveredHeatKW)} kWth</b></div><div><span>Heat injected</span><b>${fmt(mode.injectedKW)} kWth</b></div><div><span>Total COP</span><b>${mode.totalCOP == null ? "—" : fmt(mode.totalCOP, 2)}</b></div><div><span>Strict temperature eligibility</span><b>${strictEligible ? "STRICTLY ELIGIBLE" : blendedAccepted ? "STRICTLY BLOCKED · USED VIA BLENDING" : "STRICTLY BLOCKED"}</b></div><div><span>Theoretical operating cost</span><b>${fmt(operatingCost, 2)} €/h</b></div><div><span>Effective delivered heat cost</span><b>${deliveredHeatCost == null ? "—" : `${fmt(deliveredHeatCost, 2)} €/MWh`}</b></div></div>`;
    host.append(card);
  }
}

function renderComparison(result, comparison) {
  const prices = flexPrices();
  const cost = state => calculateOperatingCost({ centralPlantKW: state.centralPlantUsedKW,
    wasteHeatKW: state.dataCenterSourceHeatUsedKW,
    electricPowerKW: state.dataCenterElectricPowerKW + state.booster.electricalPowerKW }, prices)
    + Number(state.plantRampPenaltyPerHour ?? 0);
  const rows = [
    ["Temperature-critical branches", `${comparison.criticalBefore} / 6`, `${comparison.criticalAfter} / 6`],
    ["Waste heat utilized", `${fmt(result.without.wasteHeatUsedKW / 1000, 2)} MWth`, `${fmt(result.withBooster.wasteHeatUsedKW / 1000, 2)} MWth`],
    ["Central heat production", `${fmt(comparison.centralProductionBeforeKW / 1000, 2)} MWth`, `${fmt(comparison.centralProductionAfterKW / 1000, 2)} MWth`],
    ["Booster electricity", "0.00 kWe", `${fmt(comparison.boosterElectricalKW)} kWe`],
    ["System operating cost", `${fmt(cost(result.without), 2)} €/h`, `${fmt(cost(result.withBooster), 2)} €/h`]
  ];
  const boostedBranches = result.withBooster.afterBranches.filter(branch => branch.boosterActive);
  for (const branch of boostedBranches) rows.splice(1, 0, [`Branch ${branch.id} margin`, `${fmt(comparison.marginBefore[branch.id])} K`, `${fmt(comparison.marginAfter[branch.id])} K`]);
  $("before-after").innerHTML = `<div class="compare-head"><span>METRIC</span><b>WITHOUT BOOSTER</b><b>WITH BOOSTER</b></div>${rows.map(([label, before, after]) => `<div class="compare-row"><span>${label}</span><b>${before}</b><b>${after}</b></div>`).join("")}`;
}

const guidedDemoSteps = [
  { title: "THE HEAT IS ALREADY THERE.", copy: "An available waste-heat source sits below the network's current HMP temperature requirement. Available energy is not necessarily usable energy." },
  { title: "ONE CRITICAL BRANCH CAN LIMIT THE ENTIRE NETWORK.", copy: "Lowering the central temperature makes the source eligible in this example, while Branch A falls below its minimum supply requirement. The model keeps every other branch visible." },
  { title: "BOOST LOCALLY. NOT EVERYWHERE.", copy: "GridBooster lifts the selected branch to its required temperature. Activate it to see the network calculation update." },
  { title: "UNLOCK PREVIOUSLY INACCESSIBLE WASTE HEAT.", copy: "Compare the same demand, source, weather and plant assumptions. Only the HMP target and local booster configuration differ." },
  { title: "THE VALUE IS IN THE SYSTEM.", copy: "Compare avoided central production cost and net operating cost at this modeled operating point. Annual savings and payback need operating hours and investment data." }
];
let guidedDemoStep = 0;
let guidedDemoActivated = false;
const guidedDemoBooster = { id: "GB-DEMO", branchId: "A", mode: "target", targetTemp: 85, liftK: 0, cop: 3, maxThermalKW: 900 };

function guidedDemoInputs(input, hmpTargetTemp, boosters) {
  return { ...input, hmpTargetTemp, gridBoosters: boosters.map(item => ({ ...item })) };
}

function guidedOperatingCost(state, prices) {
  return calculateOperatingCost({ centralPlantKW: state.centralPlantUsedKW,
    wasteHeatKW: state.dataCenterSourceHeatUsedKW,
    electricPowerKW: state.dataCenterElectricPowerKW + state.booster.electricalPowerKW }, prices)
    + Number(state.plantRampPenaltyPerHour ?? 0);
}

function renderGuidedDemo(input) {
  const step = guidedDemoSteps[guidedDemoStep];
  $("guided-demo-step-label").textContent = `STEP ${guidedDemoStep + 1} OF 5`;
  $("guided-demo-step-title").textContent = step.title;
  $("guided-demo-step-copy").textContent = step.copy;
  $("guided-demo-assumption").textContent = "Illustrative demonstration inputs · outputs are calculated by the simplified GridBooster model, not measured or externally validated.";
  $("demo-annual-value").textContent = "Unavailable";
  $("guided-demo-activate").hidden = guidedDemoStep !== 2 || guidedDemoActivated;
  $("guided-demo-back").disabled = guidedDemoStep === 0;
  $("guided-demo-next").disabled = guidedDemoStep === 2 && !guidedDemoActivated;
  $("guided-demo-next").textContent = guidedDemoStep === 4 ? "RESTART ↻" : "NEXT →";
  document.querySelectorAll("[data-demo-goto]").forEach(button => {
    const active = Number(button.dataset.demoGoto) === guidedDemoStep;
    button.disabled = Number(button.dataset.demoGoto) > 2 && !guidedDemoActivated;
    button.classList.toggle("active", active);
    button.setAttribute("aria-current", active ? "step" : "false");
  });
  const prices = flexPrices();
  const baselineInput = guidedDemoInputs(input, 90, []);
  const optimizedInput = guidedDemoInputs(input, 80, [guidedDemoBooster]);
  try {
    const baseline = simulateNetwork(baselineInput, prices).withBooster;
    const optimized = simulateNetwork(optimizedInput, prices).withBooster;
    const additionalHeatKW = optimized.wasteHeatUsedKW - baseline.wasteHeatUsedKW;
    const avoidedCentralCost = (baseline.centralPlantUsedKW - optimized.centralPlantUsedKW) * Number(prices.centralHeatCostPerMWh ?? 40) / 1000;
    const netBenefit = guidedOperatingCost(baseline, prices) - guidedOperatingCost(optimized, prices);
    const comparisonRows = [
      ["Central plant supply temperature", `${fmtTemp(baseline.centralPlant.supplyTemp)} °C`, `${fmtTemp(optimized.centralPlant.supplyTemp)} °C`],
      ["Central HMP target", "90 °C", "80 °C"],
      ["Branches meeting minimum temperature", `${baseline.feasibleCount} / 6`, `${optimized.feasibleAfterCount} / 6`],
      ["Available waste heat source", `${fmt(baseline.wasteHeat.availableKW / 1000, 2)} MWth`, `${fmt(optimized.wasteHeat.availableKW / 1000, 2)} MWth`],
      ["Waste heat utilized", `${fmt(baseline.wasteHeatUsedKW / 1000, 2)} MWth`, `${fmt(optimized.wasteHeatUsedKW / 1000, 2)} MWth`],
      ["Central heat production", `${fmt(baseline.centralProductionKW / 1000, 2)} MWth`, `${fmt(optimized.centralProductionKW / 1000, 2)} MWth`],
      ["GridBooster electricity", "0 kWe", `${fmt(optimized.booster.electricalPowerKW)} kWe`],
      ["Total system operating cost", `${fmt(guidedOperatingCost(baseline, prices), 2)} €/h`, `${fmt(guidedOperatingCost(optimized, prices), 2)} €/h`]
    ];
    $("demo-comparison").innerHTML = comparisonRows.map(([label, before, after]) => `<div class="demo-compare-row"><span>${label}</span><b>${before}</b><b>${after}</b></div>`).join("");
    $("demo-additional-heat").textContent = `${fmt(additionalHeatKW / 1000, 2)} MWth`;
    $("demo-avoided-cost").textContent = `${fmt(avoidedCentralCost, 2)} €/h`;
    $("demo-net-benefit").textContent = `${fmt(netBenefit, 2)} €/h`;
    $("guided-demo-status").textContent = !optimized.networkOperatingPointSupported
      ? "This optimized operating point is not supported by the current model constraints. Treat its economic outputs as unavailable for a decision."
      : netBenefit < 0
        ? `Net operating benefit is negative (${fmt(netBenefit, 2)} €/h) at the entered prices. This scenario is economically unattractive.`
      : additionalHeatKW <= 0
        ? "These inputs do not unlock additional waste heat. The model reports the result without assuming a benefit."
        : `Calculated example: ${fmt(additionalHeatKW / 1000, 2)} MWth more waste heat at this operating point. Net modeled operating benefit: ${fmt(netBenefit, 2)} €/h. This is a power value, not an annual energy estimate.`;
  } catch (error) {
    $("demo-additional-heat").textContent = "Unavailable";
    $("demo-avoided-cost").textContent = "Unavailable";
    $("demo-net-benefit").textContent = "Unavailable";
    $("guided-demo-status").textContent = `Comparison unavailable: ${error.message}`;
  }
}

function applyGuidedDemoStep(step) {
  guidedDemoStep = Math.max(0, Math.min(step, guidedDemoSteps.length - 1));
  const needsBooster = guidedDemoStep >= 3 || guidedDemoStep === 2 && guidedDemoActivated;
  const target = guidedDemoStep === 0 ? 90 : 80;
  $("hmp-target").value = String(target);
  $("hmp-target-slider").value = String(target);
  gridBoosters = needsBooster ? [{ ...guidedDemoBooster }] : [];
  renderBoosterTray();
  recalculate();
}

function restartGuidedDemo() {
  loadScenario(0);
  $("dc-temp").value = "83";
  $("scenario-description").textContent = "Illustrative guided case: compare a 90 °C baseline with an 80 °C HMP target, using the same 83 °C data-center waste-heat source and a local booster on Branch A.";
  guidedDemoActivated = false;
  applyGuidedDemoStep(0);
}

function flexPrices() {
  return { electricityPricePerMWh: Number($("electricity-price").value), centralHeatCostPerMWh: Number($("central-heat-cost").value), wasteHeatCostPerMWh: Number($("waste-heat-cost").value) };
}

function sweepTargets() {
  const start = Number($("sweep-start").value), end = Number($("sweep-end").value), step = Number($("sweep-step").value);
  if (![start, end, step].every(Number.isFinite) || start < 70 || end > 95 || start > end || step <= 0) throw new Error("Choose a range from 70–95 °C with start ≤ end and a positive step.");
  const targets = [];
  for (let value = start; value <= end + 1e-9 && targets.length <= 300; value += step) targets.push(Number(value.toFixed(6)));
  if (!targets.length || targets.length > 300) throw new Error("Sweep must contain 1–300 temperature points.");
  if (targets.at(-1) < end - 1e-9) targets.push(end);
  return targets;
}

function drawFlexChart(id, points, metric, unit, currentTarget, secondaryMetric = null, scale = 1) {
  const svg = $(id); svg.replaceChildren();
  if (!points.length) return;
  const supported = points.filter(point => point.operatingPointStatus === "SUPPORTED");
  const left = 53, right = 405, top = 17, bottom = 151;
  const values = supported.flatMap(point => [point[metric], ...(secondaryMetric ? [point[secondaryMetric]] : [])])
    .filter(Number.isFinite).map(value => value * scale);
  let low = values.length ? Math.min(...values) : 0, high = values.length ? Math.max(...values) : 1;
  if (high - low < 1e-9) { const pad = Math.max(Math.abs(high) * 0.12, 1); low -= pad; high += pad; }
  else { const pad = (high - low) * 0.12; low -= pad; high += pad; }
  const minX = points[0].hmpTargetTemp, maxX = points.at(-1).hmpTargetTemp;
  const x = value => left + (maxX === minX ? 0.5 : (value - minX) / (maxX - minX)) * (right - left);
  const y = value => bottom - (value - low) / (high - low) * (bottom - top);
  svgNode(svg, "text", { x: left, y: 10, class: "flex-unit-label" }, unit);
  for (let index = 0; index <= 3; index++) {
    const val = high - (high - low) * index / 3, yy = y(val);
    svgNode(svg, "line", { x1: left, x2: right, y1: yy, y2: yy, class: "flex-grid-line" });
    svgNode(svg, "text", { x: left - 6, y: yy + 3, "text-anchor": "end", class: "flex-axis-label" }, `${fmt(val, 0)}`);
  }
  const drawSupportedSeries = key => {
    let segment = [];
    const flush = () => {
      if (segment.length > 1) svgNode(svg, "polyline", { points: segment.join(" "), class: key === metric ? "flex-series" : "flex-series flex-series-secondary" });
      else if (segment.length === 1) {
        const [cx, cy] = segment[0].split(",");
        svgNode(svg, "circle", { cx, cy, r: 2.5, class: key === metric ? "flex-point" : "flex-point flex-secondary-point" });
      }
      segment = [];
    };
    for (const point of points) {
      if (point.operatingPointStatus !== "SUPPORTED" || !Number.isFinite(point[key])) { flush(); continue; }
      segment.push(`${x(point.hmpTargetTemp)},${y(point[key] * scale)}`);
    }
    flush();
  };
  drawSupportedSeries(metric);
  if (secondaryMetric) drawSupportedSeries(secondaryMetric);
  const selected = points.reduce((best, point) => Math.abs(point.hmpTargetTemp - currentTarget) < Math.abs(best.hmpTargetTemp - currentTarget) ? point : best, points[0]);
  svgNode(svg, "line", { x1: x(selected.hmpTargetTemp), x2: x(selected.hmpTargetTemp), y1: top, y2: bottom, class: "flex-current-line" });
  points.forEach(point => {
    if (point.operatingPointStatus === "SUPPORTED") {
      if (Number.isFinite(point[metric])) svgNode(svg, "circle", { cx: x(point.hmpTargetTemp), cy: y(point[metric] * scale), r: point === selected ? 4.5 : 2, class: point === selected ? "flex-current-point" : "flex-point" });
      if (secondaryMetric && Number.isFinite(point[secondaryMetric])) svgNode(svg, "circle", { cx: x(point.hmpTargetTemp), cy: y(point[secondaryMetric] * scale), r: point === selected ? 4 : 1.7, class: "flex-current-point flex-secondary-point" });
    } else {
      const kind = point.operatingPointStatus === "CAPACITY SHORTFALL" ? "capacity-shortfall" : "temperature-unsupported";
      const marker = svgNode(svg, "text", { x: x(point.hmpTargetTemp), y: top + 10, "text-anchor": "middle", class: `flex-unsupported-point ${kind}` }, "×");
      svgNode(marker, "title", {}, `${displaySourceStatus(point.operatingPointStatus)} · ${fmtTemp(point.hmpTargetTemp)}°C HMP`);
    }
  });
  for (const point of [points[0], points[Math.floor((points.length - 1) / 2)], points.at(-1)])
    svgNode(svg, "text", { x: x(point.hmpTargetTemp), y: 174, "text-anchor": "middle", class: "flex-axis-label" }, `${fmtTemp(point.hmpTargetTemp)}°`);
  svgNode(svg, "text", { x: right, y: 188, "text-anchor": "end", class: "flex-unit-label" }, "HMP TARGET · °C");
}

function renderFlexSummary(point) {
  const cards = [
    ["HMP TARGET", `${fmt(point.hmpTargetTemp)}°C · ${point.operatingPointStatus}`, `${fmt(point.hmpTemperatureCapabilityTemp)}°C temperature capability · ${point.hmpTemperatureReachable ? `thermal shortfall ${fmt(point.thermalShortfallKW)} kW` : "target temperature not reachable"}`],
    ["BRANCHES", `${point.feasibleBranchesWithoutBooster} FEASIBLE · ${point.branchesRequiringBooster} NEED BOOST`, `${point.activeBoosterCount} active · ${point.installedBoosterCount} installed GridBooster(s)`],
    ["WASTE HEAT", `${fmt(point.usableDataCenterHeatKW)} kW`, `${point.selectedDataCenterMode.toUpperCase()} · ${point.selectedDataCenterPathUsedViaBlending ? "STRICTLY BLOCKED · USED VIA BLENDING" : point.selectedDataCenterPathEligible ? point.selectedDataCenterPathUsed ? "STRICTLY ELIGIBLE · USED" : "STRICTLY ELIGIBLE · NOT USED" : "STRICTLY BLOCKED"}`],
    ["CENTRAL PLANT", `${fmt(point.centralPlantRequiredKW)} kWth`, `${fmt(point.centralPlantActualKW)} kWth actual · ${fmt(point.centralPlantShortfallKW)} kWth short`],
    ["INSTALLED BOOSTERS", `${fmt(point.installedBoosterThermalKW)} kWth`, `${fmt(point.installedBoosterElectricKW)} kWe actual input`],
    ["HYPOTHETICAL DUTY", `${fmt(point.additionalRequiredBoosterThermalKW)} kWth`, `${fmt(point.additionalRequiredBoosterElectricKW)} kWe if all unmet branches were boosted`],
    ["DATA-CENTER HP", `${fmt(point.dataCenterElectricKW)} kWe`, `${fmt(point.dataCenterDeliveredHeatKW)} kWth delivered · ${fmt(point.dataCenterInjectedHeatKW)} kWth injected · combined COP ${point.dataCenterTotalCOP == null ? "—" : fmt(point.dataCenterTotalCOP, 2)}`],
    ["TOTAL ELECTRICITY", `${fmt(point.totalSystemElectricKW)} kWe`, `Data-center HP + installed GridBoosters`],
    ["OPERATING COST", `${fmt(point.operatingCostPerHour, 2)} €/h`, "Simplified variable operating cost"]
  ];
  const host = $("flex-summary-cards"); host.replaceChildren();
  for (const [title, value, note] of cards) {
    const card = document.createElement("article"); card.className = "flex-summary-card";
    card.innerHTML = `<span>${title}</span><strong>${value}</strong><small>${note}</small>`; host.append(card);
  }
}

function addComparisonTarget(value) {
  const target = Number(value);
  if (Number.isFinite(target) && target >= 70 && target <= 95 && !comparisonTargets.some(item => Math.abs(item - target) < 1e-8)) comparisonTargets.push(target);
  if (Number.isFinite(target)) $("comparison-temp-input").value = String(target);
  recalculate();
}

function renderFlexKeyPoints(points, currentHmp) {
  const supported = points.filter(point => point.operatingPointStatus === "SUPPORTED");
  const first = predicate => supported.find(predicate);
  const allBranches = first(point => point.feasibleBranchesWithoutBooster === 6);
  const boostIndex = supported.findIndex((point, index) => point.branchesRequiringBooster > 0 && index < supported.length - 1 && supported[index + 1].branchesRequiringBooster === 0);
  const boostTransition = boostIndex >= 0 ? supported[boostIndex + 1] : null;
  const minElectric = lowestSupportedPoint(points, "totalSystemElectricKW");
  const minCentral = lowestSupportedPoint(points, "centralPlantActualKW");
  const minCost = lowestSupportedPoint(points, "operatingCostPerHour");
  const pathPoints = [["direct", "DIRECT WASTE HEAT USABLE UP TO:"], ["one-stage", "ONE-STAGE HEAT PUMP USABLE UP TO:"], ["two-stage", "TWO-STAGE HEAT PUMP USABLE UP TO:"]]
    .map(([mode, label]) => {
      const eligible = points.filter(point => point.dataCenterModeEligibility[mode]);
      const value = !eligible.length ? "BLOCKED ACROSS SWEEP" : eligible.length === points.length
        ? "AVAILABLE ACROSS SWEEP" : `${fmtTemp(eligible.at(-1).hmpTargetTemp)}°C HMP`;
      return [label, value];
    });
  const keyPoints = [
    ["ALL BRANCHES FEASIBLE WITHOUT BOOST:", allBranches ? `${fmtTemp(allBranches.hmpTargetTemp)}°C HMP` : "NO HMP SOURCE SUPPORTED POINT"],
    ["BOOSTERS FIRST REQUIRED BELOW:", boostTransition ? `${fmtTemp(boostTransition.hmpTargetTemp)}°C HMP` : "NO HMP SOURCE SUPPORTED POINT"],
    ...pathPoints,
    ["LOWEST TOTAL ELECTRICITY POINT:", minElectric ? `${fmtTemp(minElectric.hmpTargetTemp)}°C HMP` : "NO HMP SOURCE SUPPORTED POINT"],
    ["LOWEST CENTRAL PRODUCTION POINT:", minCentral ? `${fmtTemp(minCentral.hmpTargetTemp)}°C HMP` : "NO HMP SOURCE SUPPORTED POINT"],
    ["LOWEST OPERATING COST POINT:", minCost ? `${fmtTemp(minCost.hmpTargetTemp)}°C HMP` : "NO HMP SOURCE SUPPORTED POINT"]
  ];
  $("flex-key-points").innerHTML = keyPoints.map(([label, value]) => `<div class="key-point"><span>${label}</span><b>${value}</b></div>`).join("");
  const currentPoint = points.reduce((best, point) => Math.abs(point.hmpTargetTemp - currentHmp) < Math.abs(best.hmpTargetTemp - currentHmp) ? point : best, points[0]);
  const suggestions = [[`Current HMP${currentPoint.operatingPointStatus === "SUPPORTED" ? "" : ` · ${displaySourceStatus(currentPoint.operatingPointStatus)}`}`, Number(currentHmp)],
    ["First-booster threshold", boostTransition?.hmpTargetTemp], ["Lowest electricity", minElectric?.hmpTargetTemp], ["Lowest operating cost", minCost?.hmpTargetTemp]];
  const unique = [...new Map(suggestions.filter(([, value]) => Number.isFinite(value)).map(([label, value]) => [value, [label, value]])).values()];
  const host = $("recommended-comparison-buttons");
  host.innerHTML = unique.map(([label, value]) => `<button type="button" data-add-comparison="${value}">${label} · ${fmtTemp(value)}°C ＋</button>`).join("");
  host.querySelectorAll("[data-add-comparison]").forEach(button => button.addEventListener("click", () => addComparisonTarget(button.dataset.addComparison)));
}

function renderFlexZones(points) {
  const min = points[0].hmpTargetTemp, max = points.at(-1).hmpTargetTemp;
  const rows = [["direct", "DIRECT"], ["one-stage", "ONE-STAGE"], ["two-stage", "TWO-STAGE HEAT PUMP"]].map(([mode, label]) => {
    const eligible = points.filter(point => point.dataCenterModeEligibility[mode]);
    let detail = "Strictly blocked across this sweep";
    let start = 0, width = 0;
    if (eligible.length) {
      const low = eligible[0].hmpTargetTemp, high = eligible.at(-1).hmpTargetTemp;
      detail = `${fmtTemp(low)}–${fmtTemp(high)}°C HMP · strictly eligible after connection loss`;
      start = max === min ? 0 : (low - min) / (max - min) * 100;
      width = max === min ? 100 : Math.max(2, (high - low + (points.length > 1 ? (max - min) / (points.length - 1) : 0)) / (max - min) * 100);
    }
    return `<div class="zone-row"><b>${label}</b><div class="zone-track"><i style="left:${start}%;width:${width}%"></i></div><small>${detail}</small></div>`;
  });
  $("flex-source-zones").innerHTML = rows.join("");
}

function renderBranchBands(points) {
  const branches = points[0].state.without.branches;
  const columns = `grid-template-columns:142px repeat(${points.length},minmax(26px,1fr))`;
  const head = `<div class="branch-band-row band-axis" style="${columns}"><b>BRANCH</b>${points.map(point => `<span>${fmtTemp(point.hmpTargetTemp)}°</span>`).join("")}</div>`;
  const rows = branches.map(branch => `<div class="branch-band-row" style="${columns}"><b>${branch.id} · ${escapeHtml(branch.name)}</b>${points.map(point => {
    const item = point.state.without.branches.find(candidate => candidate.id === branch.id);
    return `<span class="${item.feasibleWithoutBooster ? "band-feasible" : "band-below"}" title="${fmt(item.availableSupplyTemp)}°C available · ${fmt(item.minimumSupplyTemp)}°C minimum">${item.feasibleWithoutBooster ? "✓" : `−${fmt(item.requiredLift, 0)}`}</span>`;
  }).join("")}</div>`).join("");
  $("flex-branch-bands").innerHTML = `<div class="branch-band-wrap">${head}${rows}</div><small class="band-note">✓ temperature capable · −K indicates required local lift · fixed HMP-to-branch loss applied</small>`;
}

function renderComparisonChips() {
  const host = $("comparison-temp-chips");
  host.innerHTML = comparisonTargets.map(value => `<button type="button" class="comparison-chip" data-remove-temp="${value}">${fmt(value, 1)}°C <b aria-hidden="true">×</b></button>`).join("");
  host.querySelectorAll("[data-remove-temp]").forEach(button => button.addEventListener("click", () => {
    comparisonTargets = comparisonTargets.filter(value => value !== Number(button.dataset.removeTemp));
    renderComparisonChips(); recalculate();
  }));
}

function renderStrategyTable(input, prices) {
  const values = [...new Set(comparisonTargets)].sort((a, b) => a - b);
  const points = calculateTemperatureFlexSweep(input, values, prices);
  const columnStatus = point => point.operatingPointStatus === "SUPPORTED" ? "" : `unsupported-column ${point.operatingPointStatus === "CAPACITY SHORTFALL" ? "capacity-column" : "temperature-column"}`;
  $("strategy-table-head").innerHTML = `<tr><th>METRIC</th>${points.map(point => `<th class="${columnStatus(point)}" title="${displaySourceStatus(point.operatingPointStatus)}">HMP ${fmt(point.hmpTargetTemp, 1)}°C<small>${displaySourceStatus(point.operatingPointStatus)}</small></th>`).join("")}</tr>`;
  const totalDemandKW = input.branches.reduce((sum, branch) => sum + Number(branch.demandKW), 0);
  const rows = [
    ["Temperature capability · °C", point => point.hmpTemperatureCapabilityTemp],
    ["Temperature / thermal capacity status", point => displaySourceStatus(point.operatingPointStatus)],
    ["Network return temperature · °C", point => point.state.withBooster.networkReturnTemp],
    ["Network supply-return ΔT · K", point => point.state.withBooster.networkDeltaK],
    ["Waste heat injected · MW", point => point.dataCenterInjectedHeatKW / 1000],
    ["Waste heat share · %", point => totalDemandKW > 0 ? point.dataCenterInjectedHeatKW / totalDemandKW * 100 : 0],
    ["Central production · MW", point => point.centralPlantActualKW / 1000],
    ["Central heat share · %", point => totalDemandKW > 0 ? point.centralPlantActualKW / totalDemandKW * 100 : 0],
    ["Installed GridBooster duty · kWth", point => point.installedBoosterThermalKW],
    ["Additional hypothetical duty · kWth", point => point.additionalRequiredBoosterThermalKW],
    ["GridBooster electricity · kWe", point => point.installedBoosterElectricKW],
    ["Data-center HP electricity · kWe", point => point.dataCenterElectricKW],
    ["Total electricity · kWe", point => point.totalSystemElectricKW],
    ["Branches requiring local lift · /6", point => point.branchesRequiringBooster],
    ["Operating cost · €/h", point => point.operatingCostPerHour],
    ["Thermal shortfall · MW", point => point.thermalShortfallKW / 1000],
    ["Selected data-center path", point => `${point.selectedDataCenterMode.toUpperCase()} · ${point.selectedDataCenterPathUsedViaBlending ? "STRICTLY BLOCKED · USED VIA BLENDING" : point.selectedDataCenterPathEligible ? point.selectedDataCenterPathUsed ? "STRICTLY ELIGIBLE · USED" : "STRICTLY ELIGIBLE · NOT USED" : "STRICTLY BLOCKED"}`]
  ];
  $("strategy-table-body").innerHTML = rows.map(([label, get]) => `<tr><th>${label}</th>${points.map(point => {
    const value = get(point), display = typeof value === "number" ? fmt(value, label.includes("€/h") ? 2 : label.includes("%") ? 1 : 2) : value;
    return `<td class="${columnStatus(point)}" title="${displaySourceStatus(point.operatingPointStatus)}">${display}</td>`;
  }).join("")}</tr>`).join("");
}

function renderFlex(input, liveResult) {
  const validation = $("sweep-validation");
  try {
    const prices = flexPrices();
    if (Object.values(prices).some(value => !Number.isFinite(value) || value < 0)) throw new Error("Operating-cost inputs must be non-negative numbers.");
    const targets = sweepTargets();
    const points = calculateTemperatureFlexSweep(input, targets, prices);
    const selected = summarizeNetworkFlexState(liveResult, input, prices);
    validation.hidden = true; validation.textContent = "";
    renderFlexSummary(selected);
    drawFlexChart("flex-chart-waste", points, "usableDataCenterHeatKW", "MW", input.hmpTargetTemp, null, 0.001);
    drawFlexChart("flex-chart-central", points, "centralPlantActualKW", "MW", input.hmpTargetTemp, null, 0.001);
    drawFlexChart("flex-chart-booster-thermal", points, "additionalRequiredBoosterThermalKW", "kWth", input.hmpTargetTemp, "installedBoosterThermalKW");
    drawFlexChart("flex-chart-booster-electric", points, "additionalRequiredBoosterElectricKW", "kWe", input.hmpTargetTemp, "installedBoosterElectricKW");
    drawFlexChart("flex-chart-dc-electric", points, "dataCenterElectricKW", "kWe", input.hmpTargetTemp);
    drawFlexChart("flex-chart-system-electric", points, "totalSystemElectricKW", "kWe", input.hmpTargetTemp);
    drawFlexChart("flex-chart-branches", points, "branchesRequiringBooster", "branches", input.hmpTargetTemp);
    drawFlexChart("flex-chart-cost", points, "operatingCostPerHour", "€/h", input.hmpTargetTemp);
    renderFlexKeyPoints(points, input.hmpTargetTemp); renderFlexZones(points); renderBranchBands(points); renderComparisonChips(); renderStrategyTable(input, prices);
  } catch (error) { validation.hidden = false; validation.textContent = error.message; }
}

function renderReturnHeat(result) {
  const state = result.returnNetwork;
  $("return-heat-balance").innerHTML = [
    ["DEMAND", state.totalDemandKW], ["AVAILABLE ELIGIBLE", state.eligibleAvailableKW],
    ["ALLOCATED", state.allocatedKW], ["UNSERVED", state.unservedKW], ["UNUSED SOURCE HEAT", state.unusedSourceKW]
  ].map(([label, kw]) => `<article><span>${label}</span><b>${fmt(kw / 1000, 2)} MW</b></article>`).join("")
    ;
  set("return-temp-before", `${fmt(state.returnTempBeforeRecoveryC)}°C`);
  set("return-temp-plant", `${fmt(state.returnTempAtPlantC)}°C`);
  set("return-cooling-benefit", `${fmt(state.coolingBenefitK)} K`);
  $("return-pipe").innerHTML = state.nodes.map(node => {
    if (node.type === "CENTRAL_PLANT") return `<div class="return-node plant-return-node"><span>♨</span><b>CENTRAL PLANT</b><strong>${fmt(node.inletTempC)}°C</strong><small>RETURN RECEIVED</small></div>`;
    const source = node.type === "WASTE_HEAT_SOURCE";
    const consumer = node.type === "THREE_PIPE_CONSUMER";
    const status = source ? node.enabled === false ? "DISABLED" : node.dispatchedKW > 0 ? "INJECTING" : "UNUSED SOURCE HEAT"
      : consumer ? node.status : "ORDINARY RETURN FLOW";
    const power = source ? `+${fmt(node.dispatchedKW ?? 0)} kW INJECTION` : consumer ? `−${fmt(node.allocatedKW ?? 0)} kW EXTRACTION` : "";
    const temperatureLine = source ? `SOURCE ${fmt(node.sourceTempC)}°C · ${fmt((node.availableKW ?? 0) / 1000, 2)} MW AVAILABLE`
      : consumer ? `DEMAND ${fmt(node.demandKW)} kW · MIN ${fmt(node.minimumUsableTempC)}°C` : "ORDINARY RETURN FLOW";
    let eligibility = "";
    if (consumer) {
      const downstream = state.sources.filter(candidate => Number(candidate.order) >= Number(node.order));
      const upstream = state.sources.filter(candidate => isReturnSourceAvailableToConsumer(candidate, node));
      if (!upstream.length && downstream.length) eligibility = "SOURCE DOWNSTREAM — NOT AVAILABLE";
      else if (upstream.length && !upstream.some(candidate => Number(candidate.sourceTempC) >= Number(node.minimumUsableTempC))) eligibility = "UPSTREAM SOURCE TEMPERATURE TOO LOW";
      else if (!upstream.length) eligibility = "NO UPSTREAM SOURCE";
    }
    return `<div class="return-node ${source ? "injection-node" : consumer ? "extraction-node" : "ordinary-return-node"}"><span class="return-node-icon">${source ? "＋" : consumer ? "−" : "↙"}</span><b>${escapeHtml(node.name).toUpperCase()}</b><strong>${fmt(node.inletTempC)}°C <i>→</i> ${fmt(node.outletTempC)}°C</strong><small>${temperatureLine}</small><small>${power}</small><em>${status}</em>${eligibility ? `<small class="topology-warning">${eligibility}</small>` : ""}<small class="engineer-only">ORDER ${fmt(node.order, 0)} · FLOW ${fmt(node.returnFlowM3h ?? state.returnFlowM3h, 0)} m³/h</small></div>`;
  }).join(`<span class="return-flow-arrow" aria-hidden="true">→</span>`);
  $("return-source-balance").innerHTML = state.sources.map(source => `<article><b>${escapeHtml(source.name)}</b><span>Available ${fmt(source.availableKW / 1000, 2)} MW · dispatched ${fmt(source.dispatchedKW / 1000, 2)} MW · remaining ${fmt(source.remainingKW / 1000, 2)} MW</span></article>`).join("") || "No active return-side sources.";
  $("return-consumer-balance").innerHTML = state.consumers.map(consumer => `<article><b>${escapeHtml(consumer.name)} <i>${consumer.status}</i></b><span>Demand ${fmt(consumer.demandKW / 1000, 2)} MW · served ${fmt(consumer.allocatedKW / 1000, 2)} MW · unserved ${fmt(consumer.unservedKW / 1000, 2)} MW</span><small>Return in ${fmt(consumer.inletTempC)}°C · heat extracted ${fmt(consumer.allocatedKW)} kW · return out ${fmt(consumer.outletTempC)}°C · ΔT ${fmt(consumer.outletTempC - consumer.inletTempC)} K</small></article>`).join("") || "No active three-pipe demand.";
}

function renderFullSystem(result, input) {
  const after = result.withBooster;
  const state = result.returnNetwork;
  const consumers = new Map(state.consumers.map(consumer => [consumer.id, consumer]));
  const supermarket = state.sources.find(item => item.id === "SM-1");
  const dataCenterReturn = state.sources.find(item => item.id === "DC-RETURN");
  const plantActive = after.centralPlantUsedKW > 0 && after.centralPlant.temperatureEligible;
  const dcActive = after.wasteHeat.injectedKW > 0 || after.wasteHeat.usedViaBlending === true;
  const dcReturnActive = (dataCenterReturn?.dispatchedKW ?? 0) > 0;
  const hmpActive = after.networkOperatingPointSupported;

  $("full-plant-return").textContent = `${fmt(state.returnTempAtPlantC)}°C`;
  $("full-plant-supply").textContent = `${fmt(after.centralPlant.supplyTemp)}°C`;
  $("full-hmp-target").textContent = `TARGET ${fmt(after.hmpTargetTemp)}°C`;
  $("full-hmp-capability").textContent = `CAPABILITY ${fmt(after.hmpTemperatureCapabilityTemp)}°C`;
  $("full-dc-temp").textContent = `${fmt(Number(input.wasteHeat.injectionTemp))}°C RAW`;
  $("full-dc-mode").textContent = after.wasteHeat.mode === "direct" ? "DIRECT" : `${after.wasteHeat.mode === "one-stage" ? 1 : 2}-STAGE`;
  $("full-dc-status").textContent = input.dataCenterRouting.routing;
  $("full-dc-allocation").textContent = `HMP ${fmt(input.dataCenterRouting.supplyMW, 1)} · RETURN ${fmt(input.dataCenterRouting.returnMW, 1)} MW`;
  $("full-dc-return-label").textContent = dcReturnActive ? `RAW RETURN · +${fmt((dataCenterReturn?.dispatchedKW ?? 0) / 1000, 2)} MW` : "RAW RETURN · IDLE";
  $("full-sm-temp").textContent = `${fmt(Number(supermarket?.sourceTempC))}°C`;
  $("full-sm-power").textContent = `+${fmt((supermarket?.dispatchedKW ?? 0) / 1000, 2)} MW`;
  $("full-sm-status").textContent = supermarket?.dispatchedKW > 0 ? "RETURN ONLY" : supermarket?.enabled === false ? "OFF" : "IDLE";
  $("full-return-to-plant").textContent = `${fmt(state.returnTempAtPlantC)}°C`;
  $("full-supply-main-temp").textContent = `${fmt(after.hmpTemperatureCapabilityTemp)}°C`;
  $("full-return-main-label").textContent = `RETURN MAIN · ${fmt(state.returnTempBeforeRecoveryC)}°C BEFORE RECOVERY`;
  $("full-return-temperature-layer").textContent = `RETURN TO PLANT · ${fmt(state.returnTempAtPlantC)}°C`;
  $("full-plant-node").classList.toggle("plant-inactive", !plantActive);
  $("full-dc-node").classList.toggle("source-inactive", !dcActive && !dcReturnActive);
  $("full-dc-pipe").classList.toggle("pipe-inactive", !dcActive);
  $("full-dc-return-pipe").classList.toggle("pipe-inactive", !dcReturnActive);
  $("full-dc-return-label").classList.toggle("source-inactive", !dcReturnActive);
  $("full-sm-node").classList.toggle("source-inactive", !supermarket || supermarket.dispatchedKW <= 0);
  $("full-sm-pipe").classList.toggle("pipe-inactive", !supermarket || supermarket.dispatchedKW <= 0);
  $("full-hmp-node").classList.toggle("hmp-deficit", !hmpActive);

  $("full-branch-layer").innerHTML = after.afterBranches.map(branch => {
    const consumerId = branchReturnConsumerMap[branch.id];
    const consumer = consumerId ? consumers.get(consumerId) : null;
    const shortName = branch.name.replace("Campus high-temp", "Campus HT");
    const boosters = branch.gridBoosters.filter(item => item.actualLiftK > 0)
      .map(item => `<span class="full-booster-chip">⚡ ${escapeHtml(item.id)} · +${fmt(item.actualLiftK)} K</span>`).join("");
    const extraction = consumer ? `<div class="full-recovery-chip" title="${escapeHtml(consumer.name)} return heat recovery"><b>${escapeHtml(consumer.id)} · 3-PIPE</b><strong>−${fmt(consumer.allocatedKW / 1000, 2)} MW</strong><small>${fmt(consumer.inletTempC)}°C → ${fmt(consumer.outletTempC)}°C RETURN</small></div>` : "";
    const status = branch.boosterActive ? "BOOSTED" : branch.status === "below" ? "NEEDS LIFT" : branch.status === "close" ? "CLOSE" : "TEMP OK";
    const hybridCustomer = branch.id === "D";
    const returnPrimeKW = hybridCustomer ? Math.min(branch.demandKW * 0.2, Math.max(0, state.unusedSourceKW)) : 0;
    const supplyTopUpKW = hybridCustomer ? Math.max(0, branch.demandKW - returnPrimeKW) : 0;
    const hybridSplit = hybridCustomer ? `<div class="full-hybrid-split" aria-label="Conceptual Residential return and supply heat split"><b>RETURN PRIME<strong>${fmt(returnPrimeKW, 0)} kW</strong></b><b>SUPPLY TOP-UP<strong>${fmt(supplyTopUpKW, 0)} kW</strong></b><small>PRIMED SUPPLY · CONCEPT ONLY</small></div>` : "";
    return `<article class="full-customer-column${consumer ? " three-pipe-drop" : ""}${hybridCustomer ? " hybrid-customer-column" : ""}" data-branch="${branch.id}" ${consumer ? `data-return-consumer="${consumer.id}"` : ""}>
      <div class="full-branch-drop full-supply-drop" aria-hidden="true"></div>${boosters}
      <div class="branch-route-card full-branch-card"><div class="branch-route-head"><b class="branch-flag">${branch.id}</b><strong>${escapeHtml(shortName).toUpperCase()}</strong><span class="branch-status">${status}</span></div><div class="branch-route-values"><b class="branch-temp">${fmt(branch.finalSupplyTemp)}°C SUPPLY</b><span>MIN ${fmt(branch.minimumSupplyTemp)}°C</span><span>LOAD ${fmt(branch.demandKW / 1000, 2)} MW</span></div>${hybridSplit}${extraction}</div>
      <div class="full-branch-drop full-return-drop${hybridCustomer ? " hybrid-return-drop" : ""}" aria-hidden="true">${consumer ? `<span>RETURN HEAT IN · ${fmt(consumer.allocatedKW / 1000, 2)} MW</span>` : ""}</div>
    </article>`;
  }).join("");
}

function updateNetworkView() {
  const mode = $("network-view-selector").value;
  $("supply-network-view").hidden = mode !== "supply";
  $("return-network-view").hidden = mode !== "return";
  $("full-system-view").hidden = mode !== "full";
  $("network-map").dataset.view = mode;
}

function render(result, input) {
  const after = result.withBooster, source = after.wasteHeat, plant = after.centralPlant;
  $("hmp-target-slider").value = String(after.hmpTargetTemp);
  $("hmp-slider-value").textContent = fmt(after.hmpTargetTemp);
  set("outdoor-context", `OUTDOOR ${fmt(after.outdoorTemp)}°C · CONTEXT`);
  set("map-production-temp", `${fmt(plant.supplyTemp)}°C SOURCE`);
  set("map-plant-contribution", `${fmt(plant.contributionTemp)}°C AT HMP`);
  set("map-production-power", `${fmt(plant.availableKW)} kWth avail. · ${fmt(after.centralPlantUsedKW)} kWth used`);
  set("map-plant-availability", `${fmt(Number($("plant-availability").value), 0)}% AVAILABLE`);
  set("map-plant-loss", `−${fmt(plant.lossToHMP)} K LOSS`);
  set("map-plant-status", plant.temperatureEligible ? "✓ TEMP SUPPORTS TARGET" : "! TOO COOL FOR TARGET");
  $("map-plant-status").className = `mini-status ${plant.temperatureEligible ? "eligible" : "ineligible"}`;
  set("map-hmp-temp", `${fmt(after.hmpTemperatureCapabilityTemp)}°C ${after.sourceBlending?.selected ? "BLENDED ESTIMATE" : "CAPABILITY"}`);
  set("map-hmp-method-note", after.sourceBlending?.selected ? "SIMPLIFIED MIXING ESTIMATE · NOT HYDRAULIC" : "TEMPERATURE CAPABILITY · NOT A MIXED HMP RESULT");
  set("map-hmp-target", `TARGET ${fmt(after.hmpTargetTemp)}°C`);
  const temperatureReachable = after.hmpTemperatureReachable;
  const capacityShortfall = after.hmpPowerShortfallKW > 1e-9;
  const operatingPointSupported = after.networkOperatingPointSupported;
  const capacityWarning = $("hmp-capacity-warning");
  if (temperatureReachable && capacityShortfall) {
    capacityWarning.hidden = false;
    capacityWarning.textContent = `HMP target temperature is thermally reachable, but available source capacity is insufficient by ${fmt(after.hmpPowerShortfallKW)} kW.`;
  } else if (!temperatureReachable && after.hmpTemperatureCapabilityTemp != null) {
    capacityWarning.hidden = false;
    capacityWarning.textContent = `HMP target temperature is not thermally reachable. Available temperature capability is ${fmt(after.hmpTemperatureCapabilityTemp)}°C after source-path losses${capacityShortfall ? `, with source capacity also insufficient by ${fmt(after.hmpPowerShortfallKW)} kW` : ""}.`;
  } else if (after.hmpTemperatureCapabilityTemp == null) {
    capacityWarning.hidden = false;
    capacityWarning.textContent = "HMP temperature capability is unavailable: no active heat source has available power.";
  } else {
    capacityWarning.hidden = true;
    capacityWarning.textContent = "";
  }
  set("map-hmp-status", !temperatureReachable ? after.hmpTemperatureCapabilityTemp == null ? "⛔ NO SOURCE TEMPERATURE" : `! TEMP DEFICIT ${fmt(after.hmpTargetTemp - after.hmpTemperatureCapabilityTemp)} K` : capacityShortfall ? `⚠ TEMP REACHABLE · ${fmt(after.hmpPowerShortfallKW)} kW CAPACITY SHORT` : "✓ TEMP & CAPACITY SUFFICIENT");
  $("map-hmp-status").className = `mini-status ${operatingPointSupported ? "eligible" : "ineligible"}`;
  set("map-main-temp", `${fmt(after.hmpTemperatureCapabilityTemp)}°C ${after.sourceBlending?.selected ? "SIMPLIFIED MIXING ESTIMATE" : "CAPABILITY"} · TARGET ${fmt(after.hmpTargetTemp)}°C`);
  set("map-dc-temp", `${fmt(source.outletTemp)}°C ${source.mode.toUpperCase()}`);
  set("map-dc-contribution", `${fmt(source.contributionTemp)}°C AT HMP`);
  set("map-dc-power", `${fmt(source.availableKW)} kWth raw source · ${fmt(source.injectedKW)} kWth injected`);
  set("map-dc-availability", `${fmt(Number($("dc-availability").value), 0)}% AVAILABLE`);
  const usedViaBlending = source.usedViaBlending === true;
  const strictEligible = source.strictTemperatureEligible ?? source.injectionEligible;
  set("map-dc-loss", `−${fmt(source.lossToHMP)} K LOSS · ${usedViaBlending ? "USED VIA BLENDING ▶" : strictEligible ? "STRICTLY ELIGIBLE ▶" : "STRICTLY BLOCKED"}`);
  set("map-dc-status", usedViaBlending ? `STRICTLY BLOCKED · USED VIA BLENDED SOURCE OPERATION · ${fmt(source.injectedKW)} kWth` : !strictEligible ? "⛔ CANNOT INJECT · T ≤ HMP TARGET" : source.injectedKW > 0 ? `▶ ${source.mode.toUpperCase()} · INJECTING` : "✓ TEMP ELIGIBLE · NO HEAT INJECTED");
  $("map-dc-status").className = `mini-status ${strictEligible || usedViaBlending ? "eligible" : "ineligible"}`;
  $("plant-feed-pipe").classList.toggle("pipe-blocked", !plant.temperatureEligible || after.centralPlantUsedKW <= 0);
  $("dc-feed-pipe").classList.toggle("pipe-blocked", !(strictEligible || usedViaBlending) || source.injectedKW <= 0);
  $("hmp-node").classList.toggle("hmp-deficit", !temperatureReachable);
  $("hmp-node").classList.toggle("hmp-capacity-limited", temperatureReachable && capacityShortfall);
  renderBranches(after);
  renderReturnHeat(result);
  renderFullSystem(result, input);
  updateNetworkView();
  renderBoosterTray();
  renderSystemSummary(result, input);
  renderProfile(after); renderBranchComparison(after); renderEnergy(after); renderDataCenterModes(result); renderComparison(result, result.comparison);
  if (document.body.dataset.mode === "demo") renderGuidedDemo(input);
}

function recalculate() {
  const warning = $("network-validation");
  try { const input = readScenario(), prices = flexPrices(), result = simulateNetwork(input, prices); warning.hidden = true; warning.textContent = ""; render(result, input); renderFlex(input, result); }
  catch (error) { warning.hidden = false; warning.textContent = `Check network inputs: ${error.message}`; }
}

function loadScenario(index) {
  const scenario = scenarios[index];
  const returnDefaults = { "return-base-temp": scenario.networkReturnTemp ?? 45, "return-flow": 50,
    "sm-enabled": scenario.supermarketEnabled ? "true" : "false", "sm-temp": scenario.supermarketSourceTempC ?? 48, "sm-power": 350, "sm-max-injection": 350,
    "r1-demand": 800, "r1-min-temp": 55, "r1-max-uptake": 800, "r2-demand": 500, "r2-min-temp": scenario.r2MinimumTemp ?? 50, "r2-max-uptake": 700,
    "dc-return-order": 10, "sm-order": 15, "r1-order": scenario.upstreamR1 ? 5 : 40, "r2-order": scenario.upstreamR1 ? 40 : 30 };
  for (const [id, value] of Object.entries(returnDefaults)) $(id).value = value;
  $("network-view-selector").value = scenario.returnHeatDemo ? scenario.multiLevelWasteHeatDemo ? "full" : "return" : "supply";
  $("network-return-temp").value = scenario.networkReturnTemp ?? 40;
  $("network-reference-delta").value = scenario.referenceNetworkDeltaK ?? "";
  $("source-temperature-strategy").value = "strict";
  $("normal-plant-supply").value = scenario.plantTemp;
  $("max-ramped-plant-supply").value = Number(scenario.plantTemp) + 15;
  for (const [id, key] of [["hmp-target", "hmp"], ["outdoor-temp", "outdoor"], ["plant-temp", "plantTemp"], ["plant-power", "plantPower"], ["plant-availability", "plantAvailability"], ["plant-loss", "plantLoss"], ["dc-mode", "dcMode"], ["dc-temp", "dcTemp"], ["dc-power", "dcPower"], ["dc-supply-allocation", "dcSupplyAllocationMW"], ["dc-return-allocation", "dcReturnAllocationMW"], ["dc-availability", "dcAvailability"], ["dc-loss", "dcLoss"], ["booster-branch", "branch"], ["booster-mode", "mode"], ["booster-setpoint", "setpoint"], ["network-cop", "cop"], ["booster-capacity", "capacity"], ["dc-single-temp", "singleTemp"], ["dc-single-cop", "singleCOP"], ["dc-stage1-temp", "stage1Temp"], ["dc-stage1-cop", "stage1COP"], ["dc-stage2-temp", "stage2Temp"], ["dc-stage2-cop", "stage2COP"]]) {
    if (key === "dcSupplyAllocationMW") $(id).value = scenario[key] ?? scenario.dcPower;
    else if (key === "dcReturnAllocationMW") $(id).value = scenario[key] ?? 0;
    else $(id).value = scenario[key];
  }
  $("dc-return-max-injection").value = (scenario.dcReturnAllocationMW ?? 0) * 1000;
  for (const item of branchControls.querySelectorAll("input")) { const branch = branchDefaults.find(b => b.id === item.dataset.branch); if (branch) item.value = branch[item.dataset.key] ?? ""; }
  gridBoosters = scenario.gridBoosters.map(item => ({ ...item }));
  nextBoosterId = Math.max(1, ...gridBoosters.map(item => Number(item.id.replace(/\D/g, "")) + 1));
  $("comparison-temp-input").value = scenario.hmp;
  $("scenario-description").textContent = scenario.description;
  renderBoosterTray(); recalculate();
}

$("booster-mode").addEventListener("change", () => {
  const liftMode = $("booster-mode").value === "lift";
  $("booster-setpoint-label").textContent = liftMode ? "Booster temperature lift" : "Target branch supply";
  $("booster-setpoint-unit").textContent = liftMode ? "K" : "°C"; recalculate();
});
scenarioSelect.addEventListener("change", () => loadScenario(Number(scenarioSelect.value)));
$("hmp-target-slider").addEventListener("input", () => { $("hmp-target").value = $("hmp-target-slider").value; recalculate(); });
$("hmp-target").addEventListener("input", () => {
  const value = Number($("hmp-target").value);
  if (value >= 70 && value <= 95) $("hmp-target-slider").value = String(value);
  recalculate();
});
for (const id of ["outdoor-temp", "network-return-temp", "network-reference-delta", "plant-temp", "plant-power", "plant-availability", "plant-loss", "dc-temp", "dc-power", "dc-supply-allocation", "dc-return-allocation", "dc-return-max-injection", "dc-availability", "dc-loss", "dc-mode", "dc-single-temp", "dc-single-cop", "dc-stage1-temp", "dc-stage1-cop", "dc-stage2-temp", "dc-stage2-cop", "booster-branch", "booster-setpoint", "network-cop", "booster-capacity", "source-temperature-strategy", "normal-plant-supply", "max-ramped-plant-supply", "plant-ramp-cost"]) $(id).addEventListener("input", recalculate);
for (const id of ["sm-enabled", "return-base-temp", "return-flow", "sm-temp", "sm-power", "sm-max-injection", "r1-demand", "r1-min-temp", "r1-max-uptake", "r2-demand", "r2-min-temp", "r2-max-uptake", "dc-return-order", "sm-order", "r1-order", "r2-order"]) $(id).addEventListener("input", recalculate);
$("network-view-selector").addEventListener("change", updateNetworkView);
for (const id of ["sweep-start", "sweep-end", "sweep-step", "electricity-price", "central-heat-cost", "waste-heat-cost"]) $(id).addEventListener("input", recalculate);
$("add-comparison-temp").addEventListener("click", () => {
  const value = Number($("comparison-temp-input").value);
  addComparisonTarget(value);
});
$("add-current-temp").addEventListener("click", () => {
  const value = Number($("hmp-target").value);
  addComparisonTarget(value);
});
$("booster-branch").addEventListener("change", recalculate);
branchControls.addEventListener("input", recalculate);
$("add-gridbooster").addEventListener("click", () => {
  const target = $("booster-mode").value === "target";
  const item = { id: `GB-${nextBoosterId++}`, branchId: "",
    mode: target ? "target" : "lift", targetTemp: target ? Number($("booster-setpoint").value) : 0,
    liftK: target ? 0 : Number($("booster-setpoint").value), cop: Number($("network-cop").value), maxThermalKW: Number($("booster-capacity").value) };
  assignBoosterBranch(item, $("booster-branch").value === "none" ? "" : $("booster-branch").value);
  gridBoosters.push(item);
  renderBoosterTray(); recalculate();
});
loadScenario(0);

const consultButtonLabel = "▶ RUN CONSULTANCY ANALYSIS";
const consultKpis = [
  { id: "consult-kpi-alignment", final: "100%", values: ["74%", "88%", "94%", "112%", "100%"], stopAt: 1700 },
  { id: "consult-kpi-innovation", final: "VERY HIGH", values: ["MODERATE", "HIGH", "DISRUPTIVE", "TRANSFORMATIVE", "VERY HIGH"], stopAt: 2000 },
  { id: "consult-kpi-investment", final: "YES", values: ["MAYBE", "REVIEW", "YES", "ABSOLUTELY", "YES"], stopAt: 2250 },
  { id: "consult-kpi-consulting", final: "STRONGLY", values: ["POSSIBLY", "LIKELY", "DEFINITELY", "STRONGLY"], stopAt: 2500 }
];
let consultRunToken = 0;
let consultRunning = false;

function setConsultFinalValues() {
  for (const kpi of consultKpis) {
    const value = $(kpi.id);
    value.textContent = kpi.final;
    value.classList.remove("rolling");
  }
}

function finishConsultAnalysis(runToken) {
  if (!consultRunning || runToken !== consultRunToken || document.body.dataset.mode !== "consult") return;
  consultRunning = false;
  $("consult-loading").hidden = true;
  $("consult-followup").hidden = false;
  const button = $("consult-run");
  button.disabled = false;
  button.textContent = consultButtonLabel;
}

function setAudienceMode(mode) {
  document.body.dataset.mode = mode;
  for (const option of ["demo", "casual", "engineer", "consult"]) {
    const button = $(`mode-${option}`);
    button.classList.toggle("active", mode === option);
    button.setAttribute("aria-pressed", String(mode === option));
  }
  $("consult-panel").hidden = mode !== "consult";
  $("normal-economics").hidden = mode !== "casual";
  renderBoosterTray();
  recalculate();
  if (mode !== "consult") {
    consultRunToken++;
    consultRunning = false;
    setConsultFinalValues();
    const button = $("consult-run");
    button.disabled = false;
    button.textContent = consultButtonLabel;
    $("consult-loading").hidden = true;
    $("consult-result").hidden = true;
    $("consult-followup").hidden = true;
  }
}

for (const mode of ["demo", "casual", "engineer", "consult"]) $(`mode-${mode}`).addEventListener("click", () => {
  setAudienceMode(mode);
  if (mode === "demo") restartGuidedDemo();
});
$("quick-demo-start").addEventListener("click", () => {
  setAudienceMode("demo");
  restartGuidedDemo();
  $("guided-demo").scrollIntoView?.({ behavior: "smooth", block: "start" });
});
$("guided-demo-back").addEventListener("click", () => applyGuidedDemoStep(guidedDemoStep - 1));
$("guided-demo-next").addEventListener("click", () => {
  if (guidedDemoStep === 4) restartGuidedDemo();
  else if (guidedDemoStep !== 2 || guidedDemoActivated) applyGuidedDemoStep(guidedDemoStep + 1);
});
$("guided-demo-restart").addEventListener("click", restartGuidedDemo);
$("guided-demo-activate").addEventListener("click", () => {
  guidedDemoActivated = true;
  applyGuidedDemoStep(2);
});
document.querySelectorAll("[data-demo-goto]").forEach(button => button.addEventListener("click", () => {
  const destination = Number(button.dataset.demoGoto);
  if (destination > 2 && !guidedDemoActivated) return;
  applyGuidedDemoStep(destination);
}));
guidedDemoActivated = false;
$("dc-temp").value = "83";
$("scenario-description").textContent = "Illustrative guided case: compare a 90 °C baseline with an 80 °C HMP target, using the same 83 °C data-center waste-heat source and a local booster on Branch A.";
applyGuidedDemoStep(0);

$("consult-run").addEventListener("click", () => {
  const button = $("consult-run");
  if (document.body.dataset.mode !== "consult" || consultRunning) return;
  setConsultFinalValues();
  $("consult-result").hidden = false;
  $("consult-followup").hidden = true;
  const loading = $("consult-loading");
  loading.hidden = false;
  loading.textContent = "Aligning stakeholders…";
  const reduceMotion = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (reduceMotion) {
    loading.hidden = true;
    $("consult-followup").hidden = false;
    return;
  }

  button.disabled = true;
  button.textContent = "ANALYSING SYNERGIES...";
  consultRunning = true;
  const runToken = ++consultRunToken;
  setTimeout(() => { if (consultRunning && runToken === consultRunToken && document.body.dataset.mode === "consult") loading.textContent = "Reviewing synergy opportunities…"; }, 750);
  setTimeout(() => { if (consultRunning && runToken === consultRunToken && document.body.dataset.mode === "consult") loading.textContent = "Preparing the roadmap…"; }, 1500);

  let remaining = consultKpis.length;
  for (const kpi of consultKpis) {
    const value = $(kpi.id);
    let elapsed = 0;
    let index = 0;
    const roll = () => {
      if (!consultRunning || runToken !== consultRunToken || document.body.dataset.mode !== "consult") return;
      if (elapsed >= kpi.stopAt) {
        value.textContent = kpi.final;
        value.classList.remove("rolling");
        if (--remaining === 0) finishConsultAnalysis(runToken);
        return;
      }
      value.textContent = kpi.values[index++ % kpi.values.length];
      value.classList.add("rolling");
      const delay = Math.min(125, kpi.stopAt - elapsed);
      elapsed += delay;
      setTimeout(roll, delay);
    };
    roll();
  }
});
