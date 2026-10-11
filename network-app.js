import { simulateNetwork, calculateTemperatureFlexSweep, summarizeNetworkFlexState, calculateOperatingCost, lowestSupportedPoint, isReturnSourceAvailableToConsumer, calculatePip3HeatSplit, findPrimaryTemperatureBottleneck } from "./network-model.js?v=20261011-2";
import { analyzeSystemOpportunity, calculateOpportunityIntervention, calculateMarginalTemperature, calculateSourceTemperatureIntervention, clearScenarioSlot, compareScenarioSnapshots, restoreScenarioSnapshot, saveScenarioSlot } from "./network-insights.js?v=20261011-2";
import { buildSensitivityValues, calculateKeySensitivities, calculateSensitivitySweep, createSensitivitySpec, summarizeSensitivitySweep } from "./network-sensitivity.js?v=20261011-2";

const $ = id => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Required network UI element #${id} is missing.`);
  return element;
};
const heroCopy = document.querySelector?.(".hero-copy");
const heroLede = document.querySelector?.(".hero-lede");
const hero = document.querySelector?.(".hero");
if (hero && heroCopy && heroLede && typeof window !== "undefined" && typeof ResizeObserver !== "undefined") {
  const updateHeroSplit = () => document.body.style.setProperty("--hero-split-y", `${Math.round(heroLede.getBoundingClientRect().top - hero.getBoundingClientRect().top)}px`);
  const heroSplitObserver = new ResizeObserver(updateHeroSplit);
  heroSplitObserver.observe(heroCopy);
  heroSplitObserver.observe(heroLede);
  window.addEventListener("resize", updateHeroSplit, { passive: true });
  updateHeroSplit();
}
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
const translate = (key, params) => globalThis.window?.t?.(key, params) ?? key;
const branchName = branch => globalThis.window?.t?.(`branch.name.${branch.id.toLowerCase()}`) || branch.name;
const scenarios = [
  { name: "1 — Conventional high-temperature grid", description: "At 90 °C, all six branches meet their minimums without local lift. The one-stage data-center path is blocked after its fixed path loss; the central plant supplies the full demand.", hmp: 90, outdoor: 2, plantTemp: 98, plantPower: 15, plantAvailability: 100, plantLoss: 2, dcTemp: 60, dcPower: 2.4, dcAvailability: 85, dcLoss: 1.5, dcMode: "one-stage", branch: "none", mode: "target", setpoint: 85, cop: 3, capacity: 900, singleTemp: 75, singleCOP: 3, stage1Temp: 70, stage1COP: 3, stage2Temp: 85, stage2COP: 3, networkReturnTemp: 40, referenceNetworkDeltaK: null, gridBoosters: [] },
  { name: "2 — Temperature Flex / local boosting", description: "The two-stage data-center path reaches the 80 °C HMP after connection loss; only high-temperature Branch A falls below its minimum. An installed Gridbooster restores that branch locally.", hmp: 80, outdoor: 0, plantTemp: 95, plantPower: 15, plantAvailability: 100, plantLoss: 2, dcTemp: 83, dcPower: 2.4, dcAvailability: 85, dcLoss: 1.5, dcMode: "two-stage", branch: "A", mode: "target", setpoint: 85, cop: 3, capacity: 900, singleTemp: 75, singleCOP: 3, stage1Temp: 70, stage1COP: 3, stage2Temp: 85, stage2COP: 3, networkReturnTemp: 40, referenceNetworkDeltaK: null, gridBoosters: [{ id: "GB-1", branchId: "A", mode: "target", targetTemp: 85, liftK: 0, cop: 3, maxThermalKW: 900 }] },
  { name: "3 — Data-center two-stage heat pump", description: "The two-stage heat pump makes the data-center source usable at the HMP, but the high-temperature Branch A still requires local temperature lift.", hmp: 82, outdoor: 4, plantTemp: 98, plantPower: 15, plantAvailability: 100, plantLoss: 2, dcTemp: 50, dcPower: 2.4, dcAvailability: 100, dcLoss: 2, dcMode: "two-stage", branch: "none", mode: "target", setpoint: 85, cop: 3, capacity: 900, singleTemp: 75, singleCOP: 3, stage1Temp: 70, stage1COP: 3, stage2Temp: 85, stage2COP: 3, networkReturnTemp: 40, referenceNetworkDeltaK: null, gridBoosters: [] },
  { name: "4 — Aggressive low-temperature grid", description: "At a very low HMP temperature, one-stage data-center heat is available, but Branches A, B, C, D and E require local temperature upgrading and booster electricity becomes significant.", hmp: 70, outdoor: -4, plantTemp: 90, plantPower: 15, plantAvailability: 100, plantLoss: 2, dcTemp: 65, dcPower: 2.4, dcAvailability: 100, dcLoss: 1.5, dcMode: "one-stage", branch: "A", mode: "target", setpoint: 85, cop: 2.5, capacity: 2000, singleTemp: 75, singleCOP: 3, stage1Temp: 70, stage1COP: 3, stage2Temp: 85, stage2COP: 3, networkReturnTemp: 40, referenceNetworkDeltaK: null, gridBoosters: [
    { id: "GB-1", branchId: "A", mode: "target", targetTemp: 85, liftK: 0, cop: 2.5, maxThermalKW: 2000 },
    { id: "GB-2", branchId: "B", mode: "target", targetTemp: 78, liftK: 0, cop: 2.5, maxThermalKW: 2000 },
    { id: "GB-3", branchId: "C", mode: "target", targetTemp: 74, liftK: 0, cop: 2.5, maxThermalKW: 2000 },
    { id: "GB-4", branchId: "E", mode: "target", targetTemp: 76, liftK: 0, cop: 2.5, maxThermalKW: 2000 },
    { id: "GB-5", branchId: "D", mode: "target", targetTemp: 70, liftK: 0, cop: 2.5, maxThermalKW: 2000 }
  ] },
  { ...{
    name: "5 — Return Heat Network",
    description: "Follow a 43 °C return line toward the plant. PIP3 Branch D is upstream of the raw data-center injection and gets supply only; downstream PIP3 branches E and F take eligible return heat.",
    hmp: 90, outdoor: 2, plantTemp: 98, plantPower: 15, plantAvailability: 100, plantLoss: 2, dcTemp: 60, dcPower: 2.4, dcAvailability: 85, dcLoss: 1.5, dcMode: "raw-return", branch: "none", mode: "target", setpoint: 85, cop: 3, capacity: 900, singleTemp: 75, singleCOP: 3, stage1Temp: 70, stage1COP: 3, stage2Temp: 85, stage2COP: 3, networkReturnTemp: 43, returnFlowM3h: 500, referenceNetworkDeltaK: null, gridBoosters: []
  }, returnHeatDemo: true, pip3Orders: { D: 5, E: 30, F: 40 } },
  { ...{
    name: "6 — Multi-Level Waste Heat Network",
    description: "The data center upgrades waste heat through the two-stage supply path. An independent supermarket return source fully supplies PIP3 branches E and F; downstream D receives the remaining return heat and supply top-up.",
    hmp: 82, outdoor: 2, plantTemp: 98, plantPower: 15, plantAvailability: 100, plantLoss: 2, dcTemp: 60, dcPower: 2.4, dcAvailability: 100, dcLoss: 1.5, dcMode: "two-stage", branch: "none", mode: "target", setpoint: 85, cop: 3, capacity: 900, singleTemp: 75, singleCOP: 3, stage1Temp: 70, stage1COP: 3, stage2Temp: 85, stage2COP: 3, networkReturnTemp: 43, returnFlowM3h: 500, referenceNetworkDeltaK: null, gridBoosters: [{ id: "GB-1", branchId: "B", mode: "target", targetTemp: 78, liftK: 0, cop: 3, maxThermalKW: 900 }]
  }, returnHeatDemo: true, multiLevelWasteHeatDemo: true, supermarketEnabled: true, supermarketSourceTempC: 48, supermarketPowerKW: 4400, pip3Orders: { D: 40, E: 20, F: 30 } }
];
const branchControls = $("branch-controls");
const scenarioSelect = $("scenario-select");
const branchInputs = new Map();
let gridBoosters = [];
let nextBoosterId = 1;
let comparisonTargets = [75, 80, 82, 85];
let selectedNetworkBranch = "";
let selectedPip3Branch = "D";
let bottleneckFound = false;
let demoConstraintAddressed = false;
let demoComparisonBaseline = false;
let latestNetworkState = null;
let scenarioSnapshots = { baseline: null, optionA: null, optionB: null };
let sensitivityResult = null;
let sensitivityKeyResults = [];
let sensitivityBaselineSignature = "";
let sensitivityStaleReason = "";
const set = (id, value) => { $(id).textContent = value; };
const svgNode = (svg, tag, attrs = {}, text = "") => {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  if (text) node.textContent = text;
  svg.append(node);
  return node;
};
const branchSelector = selected => `<select data-booster-id="${selected.id}" data-booster-key="branchId" aria-label="${escapeHtml(translate("interaction.place_on_branch", { id: selected.id }))}"><option value="">${escapeHtml(translate("interaction.unplaced"))}</option>${branchDefaults.map(b => `<option value="${b.id}" ${selected.branchId === b.id ? "selected" : ""}>${b.id} · ${escapeHtml(branchName(b))}</option>`).join("")}</select>`;

function assignBoosterBranch(item, branchId) {
  item.branchId = branchId;
  if (document.body.dataset.mode === "casual" && branchId) {
    const branch = branchDefaults.find(candidate => candidate.id === branchId);
    const minimumInput = branchControls.querySelectorAll("input").find(input => input.dataset.branch === branchId && input.dataset.key === "minimumSupplyTemp");
    if (branch) { item.mode = "target"; item.targetTemp = Number(minimumInput?.value ?? branch.minimumSupplyTemp); }
  }
}

function allocateBoosterId() {
  while (gridBoosters.some(item => item.id === `GB-${nextBoosterId}`)) nextBoosterId++;
  return `GB-${nextBoosterId++}`;
}

for (const branch of branchDefaults) {
  const card = document.createElement("div");
  card.className = "branch-input-card";
  card.innerHTML = `<div class="branch-input-title"><b>BRANCH ${branch.id}</b><span>customer path</span></div>
    <label>Branch name <span class="branch-input-wrap"><input data-branch="${branch.id}" data-key="name" type="text" value="${escapeHtml(branchName(branch))}" data-default-branch-name="${branch.id}"></span></label>
    <label>Heat demand <span class="branch-input-wrap"><input data-branch="${branch.id}" data-key="demandKW" type="number" min="0" step="any" value="${branch.demandKW}"><b>kWth</b></span></label>
    <label>Minimum supply <span class="branch-input-wrap"><input data-branch="${branch.id}" data-key="minimumSupplyTemp" type="number" step="any" value="${branch.minimumSupplyTemp}"><b>°C</b></span></label>
    <label>Branch flow <span class="branch-input-wrap"><input data-branch="${branch.id}" data-key="flowM3h" type="number" min="0" step="any" value="${branch.flowM3h}"><b>m³/h</b></span></label>
    <label>HMP → branch ΔT loss <span class="branch-input-wrap"><input data-branch="${branch.id}" data-key="lossToBranch" type="number" min="0" step="any" value="${branch.lossToBranch}"><b>K</b></span></label>
    <details class="branch-advanced"><summary>Optional branch return</summary><label>Branch return temperature <span class="branch-input-wrap"><input data-branch="${branch.id}" data-key="returnTemp" type="number" step="any" placeholder="—"><b>°C</b></span></label></details>`;
  branchControls.append(card);
}
let languageBranchNames = new Map(branchDefaults.map(branch => [branch.id, branchName(branch)]));
document.addEventListener?.("click", event => {
  if (!event.target?.closest?.("[data-language-code]")) return;
  queueMicrotask(() => {
    for (const branch of branchDefaults) {
      const input = [...branchControls.querySelectorAll("input")].find(candidate => candidate.dataset.defaultBranchName === branch.id);
      if (!input) continue;
      const previousDefault = languageBranchNames.get(branch.id);
      if (input.value === previousDefault || input.value === branch.name) input.value = branchName(branch);
      languageBranchNames.set(branch.id, branchName(branch));
    }
    render();
    refreshSensitivityControls(false);
    if (sensitivityResult) renderSensitivityResult();
    if (sensitivityStaleReason) setSensitivityStale(sensitivityStaleReason);
  });
});
for (const [index, scenario] of scenarios.entries()) {
  const option = document.createElement("option");
  option.value = String(index); option.textContent = scenario.name; scenarioSelect.append(option);
}

function readScenario() {
  const rawTemp = Number($("dc-temp").value);
  $("dc-single-temp").min = String(rawTemp + 5);
  $("dc-single-temp").max = "75";
  $("dc-stage1-temp").max = "75";
  $("dc-stage2-temp").min = "75";
  $("dc-stage2-temp").max = "85";
  const get = id => $(id).value;
  const values = branchControls.querySelectorAll("input");
  const scenarioBranches = branchDefaults.map(branch => {
    const fields = Object.fromEntries([...values].filter(input => input.dataset.branch === branch.id).map(input => [input.dataset.key, input.value]));
    return { ...branch, ...fields, returnTemp: fields.returnTemp === "" || fields.returnTemp == null ? null : Number(fields.returnTemp) };
  });
  const target = get("booster-mode") === "target";
  const rawReturnSelected = get("dc-mode") === "raw-return";
  const pip3Nodes = scenarioBranches.filter(branch => ["D", "E", "F"].includes(branch.id)).map(branch => ({
    id: branch.id, name: `PIP3 Branch ${branch.id}`, type: "THREE_PIPE_CONSUMER", order: get(`pip3-${branch.id.toLowerCase()}-order`), enabled: true,
    demandKW: branch.demandKW, minimumUsableTempC: get(`pip3-${branch.id.toLowerCase()}-min-temp`), maxUptakeKW: get(`pip3-${branch.id.toLowerCase()}-max-uptake`)
  }));
  const returnNetwork = { baseReturnTempC: get("return-base-temp"), returnFlowM3h: get("return-flow"), nodes: [
    { id: "DC-RETURN", sourceGroupId: "DATA-CENTER", name: "DATA CENTER RETURN", type: "WASTE_HEAT_SOURCE", returnOnly: true, order: get("dc-return-order"), enabled: rawReturnSelected, sourceTempC: get("dc-temp"), availableKW: rawReturnSelected ? get("dc-power") * 1000 * get("dc-availability") / 100 : 0, maxInjectionKW: get("dc-return-max-injection") },
    { id: "SM-1", name: "SUPERMARKET", type: "WASTE_HEAT_SOURCE", returnOnly: true, order: get("sm-order"), enabled: get("sm-enabled") === "true", sourceTempC: get("sm-temp"), availableKW: get("sm-power"), maxInjectionKW: get("sm-max-injection") },
    ...pip3Nodes,
    { id: "PLANT", name: "Central plant", type: "CENTRAL_PLANT", order: 100 }
  ] };
  return {
    hmpTargetTemp: get("hmp-target"), outdoorTemp: get("outdoor-temp"), networkReturnTemp: get("network-return-temp"),
    referenceNetworkDeltaK: get("network-reference-delta") === "" ? null : get("network-reference-delta"), branches: scenarioBranches,
    sourceTemperatureStrategy: document.body.dataset.mode === "engineer" ? get("source-temperature-strategy") : "strict", normalPlantSupplyTemp: get("normal-plant-supply"),
    maxRampedPlantSupplyTemp: get("max-ramped-plant-supply"), plantRampCostPerMWhPerK: get("plant-ramp-cost"),
    centralPlant: { supplyTemp: get("plant-temp"), maxPowerMW: get("plant-power"), availabilityPercent: get("plant-availability"), lossToHMP: get("plant-loss") },
    wasteHeat: { injectionTemp: get("dc-temp"), maxPowerMW: get("dc-power"), availabilityPercent: get("dc-availability"), lossToHMP: get("dc-loss"),
      mode: get("dc-mode"), singleStageOutletTemp: get("dc-single-temp"), singleStageCOP: get("dc-single-cop"),
      stage1OutletTemp: get("dc-stage1-temp"), stage1COP: get("dc-stage1-cop"), stage2OutletTemp: get("dc-stage2-temp"), stage2COP: get("dc-stage2-cop") },
    returnNetwork,
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
  if (!gridBoosters.length) { host.innerHTML = `<p class="booster-tray-empty">${escapeHtml(translate("interaction.booster_empty"))}</p>`; return; }
  for (const item of gridBoosters) {
    const card = document.createElement("article");
    card.className = `gridbooster-token${item.branchId ? " placed" : " unplaced"}`;
    card.draggable = true; card.dataset.boosterId = item.id;
    const value = item.mode === "target" ? item.targetTemp : item.liftK;
    const casual = document.body.dataset.mode === "casual";
    const calculatedBranch = latestNetworkState?.withBooster.afterBranches.find(branch => branch.gridBoosters.some(booster => booster.id === item.id));
    const calculatedBooster = calculatedBranch?.gridBoosters.find(booster => booster.id === item.id);
    const placementState = item.branchId ? translate("interaction.on_branch", { branch: item.branchId }) : translate("interaction.unplaced");
    const casualStatus = !item.branchId ? translate("interaction.unplaced_needs_placement")
      : calculatedBooster?.actualLiftK > 0 ? translate("interaction.auto_target", { temperature: `${fmtTemp(value)} °C` })
        : calculatedBranch?.feasibleWithoutBooster ? `${translate("interaction.auto_target", { temperature: `${fmtTemp(value)} °C` })} · ${translate("interaction.no_lift_required")}`
          : translate("interaction.no_lift_applied");
    card.innerHTML = `<header><span>⚡</span><b>${item.id}</b><span class="booster-placement-state">${escapeHtml(placementState)}</span><button type="button" data-booster-remove="${item.id}" aria-label="${escapeHtml(translate("interaction.remove_booster", { id: item.id }))}">×</button></header>
      <label>${escapeHtml(translate("interaction.place_on_branch_label"))} ${branchSelector(item)}</label>
      ${casual ? `<p class="auto-boost-note">${escapeHtml(casualStatus)}</p>` : `<label>${item.mode === "target" ? "Target outlet" : "Requested lift"}<span class="booster-token-input"><input data-booster-id="${item.id}" data-booster-key="${item.mode === "target" ? "targetTemp" : "liftK"}" type="number" step="any" value="${value}"><b>${item.mode === "target" ? "°C" : "K"}</b></span></label>
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

function closeNetworkInspector(mode = document.body.dataset.mode) {
  const panel = $("network-inspector");
  const returnFocus = panel.contains?.(document.activeElement);
  panel.hidden = true;
  $("network-inspector-title").textContent = "";
  $("network-inspector-copy").replaceChildren();
  if (returnFocus) $(`mode-${mode}`).focus?.();
}

function syncWhyAccessPoints() {
  const enabled = document.body.dataset.mode === "demo";
  const focusedWhy = !enabled && document.activeElement?.closest?.(".network-why-button");
  for (const [id, kind] of [["hmp-node", "hmp"], ["dc-node", "source"], ["full-hmp-node", "hmp"], ["full-dc-node", "source"]]) {
    const host = $(id);
    const current = host.querySelector(".network-why-button");
    if (!enabled) {
      if (current) host.removeChild(current);
      continue;
    }
    if (current) continue;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "network-why-button";
    button.dataset.inspectKind = kind;
    button.setAttribute("data-i18n", "interaction.why");
    button.setAttribute("aria-label", translate("interaction.why"));
    button.textContent = translate("interaction.why");
    host.append(button);
  }
  if (!enabled) {
    closeNetworkInspector();
    if (focusedWhy) $("mode-" + document.body.dataset.mode).focus?.();
  }
}

function showInspector(titleKey, rows) {
  if (document.body.dataset.mode !== "demo") return;
  $("network-inspector-title").textContent = translate(titleKey);
  $("network-inspector-copy").innerHTML = rows.map(([label, value]) => `<p><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b></p>`).join("");
  $("network-inspector").hidden = false;
  $("network-inspector-close").focus?.();
}

function inspectBranch(branch) {
  showInspector("interaction.why_branch", [
    [translate("interaction.hmp_capability"), `${fmt(latestNetworkState?.withBooster.hmpTemperatureCapabilityTemp)} °C`],
    [translate("interaction.path_loss"), `${fmt(branch.lossToBranch)} K`],
    [translate("interaction.available_branch"), `${fmt(branch.availableSupplyTemp)} °C`],
    [translate("interaction.required_min"), `${fmt(branch.minimumSupplyTemp)} °C`],
    [translate("interaction.deficit"), `${fmt(Math.max(0, -Number(branch.finalMargin)))} K`]
  ]);
}

function inspectObject(kind) {
  const state = latestNetworkState?.withBooster;
  if (!state) return;
  if (kind === "hmp") showInspector("interaction.why_hmp", [
    [translate("interaction.hmp_target"), `${fmt(state.hmpTargetTemp)} °C`],
    [translate("interaction.hmp_capability"), `${fmt(state.hmpTemperatureCapabilityTemp)} °C`],
    [translate("interaction.source_capacity"), `${fmt(state.hmpPowerAvailableKW / 1000, 2)} MWth`],
    [translate("interaction.temperature_and_capacity"), state.networkOperatingPointSupported ? translate("interaction.satisfied") : translate("interaction.not_satisfied", { shortfall: fmt(state.hmpPowerShortfallKW) })]
  ]);
  if (kind === "source") showInspector(state.wasteHeat.mode !== "raw-return" && !state.wasteHeat.strictTemperatureEligible ? "interaction.why_source" : "interaction.source_state", [
    [translate("interaction.selected_route"), translate(`interaction.source_route_${state.wasteHeat.mode === "raw-return" ? "raw" : state.wasteHeat.mode === "one-stage" ? "one" : "two"}`)],
    [translate("interaction.raw_source"), `${fmt(Number($("dc-temp").value))} °C · ${fmt(state.wasteHeat.availableKW / 1000, 2)} MWth`],
    [translate("interaction.outlet_temp"), state.wasteHeat.mode === "raw-return" ? translate("interaction.source_route_raw") : `${fmt(state.wasteHeat.outletTemp)} °C`],
    [translate("interaction.at_hmp"), state.wasteHeat.mode === "raw-return" ? translate("interaction.source_route_raw") : `${fmt(state.wasteHeat.contributionTemp)} °C`],
    [translate("interaction.hmp_injection"), `${fmt(state.wasteHeat.injectedKW / 1000, 2)} MWth`],
    [translate("interaction.status"), state.wasteHeat.mode === "raw-return" ? translate("interaction.return_only") : state.wasteHeat.strictTemperatureEligible ? translate("interaction.temperature_eligible") : translate("interaction.source_below_target")]
  ]);
  if (kind === "supermarket") {
    const source = latestNetworkState.returnNetwork.sources.find(item => item.id === "SM-1");
    if (source) showInspector(source.dispatchedKW > 0 ? "interaction.source_state" : "interaction.why_source", [
      [translate("interaction.source_capacity"), `${fmt(source.availableKW / 1000, 2)} MWth`],
      [translate("interaction.outlet_temp"), `${fmt(source.sourceTempC)} °C`],
      [translate("interaction.dispatch"), `${fmt(source.dispatchedKW / 1000, 2)} MWth`],
      [translate("interaction.topology"), `${translate("interaction.order")} ${fmt(source.order, 0)}`],
      [translate("interaction.status"), source.enabled === false ? translate("interaction.disabled") : source.dispatchedKW > 0 ? translate("interaction.dispatched") : translate("interaction.unused")]
    ]);
  }
  if (kind === "pip3") {
    const consumer = latestNetworkState.returnNetwork.nodes.find(node => node.id === selectedPip3Branch);
    if (!consumer) return;
    const split = calculatePip3HeatSplit(consumer.demandKW, consumer.allocatedKW);
    const upstreamSources = latestNetworkState.returnNetwork.sources.filter(source => isReturnSourceAvailableToConsumer(source, consumer)
      && Number(source.sourceTempC) >= Number(consumer.minimumUsableTempC) && Number(source.availableKW) > 0);
    showInspector("interaction.why_pip3", [
      [translate("interaction.total_demand"), `${fmt(split.demandKW / 1000, 2)} MWth`],
      [translate("interaction.return_heat"), `${fmt(split.returnHeatKW / 1000, 2)} MWth`],
      [translate("interaction.supply_topup"), `${fmt(split.supplyTopUpKW / 1000, 2)} MWth`],
      [translate("interaction.return_eligibility"), `${fmt(consumer.inletTempC)} °C · ${translate("interaction.min_temp", { temperature: fmt(consumer.minimumUsableTempC) })}`],
      [translate("interaction.upstream_source"), upstreamSources.map(source => source.name).join(", ") || translate("interaction.none")]
    ]);
  }
  if (kind === "booster") {
    const booster = state.afterBranches.flatMap(branch => branch.gridBoosters.map(item => ({ ...item, branchId: branch.id }))).find(item => item.branchId === selectedNetworkBranch);
    if (!booster) return;
    showInspector("interaction.why_booster", [
      [translate("interaction.inlet_temp"), `${fmt(booster.inletTemp)} °C`], [translate("interaction.outlet_temp"), `${fmt(booster.outletTemp)} °C`],
      [translate("interaction.actual_lift"), `${fmt(booster.actualLiftK)} K`],
      [translate("interaction.thermal_duty"), `${fmt(booster.thermalPowerKW)} kWth`],
      [translate("interaction.electrical_input"), `${fmt(booster.electricalPowerKW)} kWe`],
      [translate("interaction.capacity_status"), booster.capacitySufficient ? translate("interaction.capacity_sufficient") : translate("interaction.capacity_insufficient")]
    ]);
  }
}

function selectNetworkBranch(branch) {
  selectedNetworkBranch = branch.id;
  if (["D", "E", "F"].includes(branch.id)) selectedPip3Branch = branch.id;
  const bottleneck = findPrimaryTemperatureBottleneck(latestNetworkState?.withBooster.afterBranches ?? []);
  if (guidedDemoStep === 1) {
    if (!bottleneck) $("demo-branch-feedback").textContent = translate("interaction.no_constraint");
    else if (branch.id === bottleneck.id) {
      bottleneckFound = true;
      $("demo-branch-feedback").textContent = translate("interaction.constraint_found", { branch: bottleneck.id, deficit: fmt(-bottleneck.finalMargin) });
    } else $("demo-branch-feedback").textContent = translate("interaction.try_another");
  }
  if (guidedDemoStep === 2) $("guided-demo-activate").disabled = !selectedNetworkBranch;
  recalculate();
}

function renderBranches(result) {
  const hosts = { top: $("network-branches-top"), bottom: $("network-branches-bottom") };
  Object.values(hosts).forEach(host => host.replaceChildren());
  for (const branch of result.afterBranches) {
    const [status, label] = classify(branch);
    const selected = selectedNetworkBranch === branch.id || branch.gridBoosters.length > 0;
    const row = document.createElement("article");
    row.className = `network-branch-row ${status}${selected ? " selected" : ""}${!branch.feasibleWithoutBooster ? " needs-booster" : ""}`;
    row.dataset.branch = branch.id;
    row.tabIndex = 0; row.setAttribute("role", "button"); row.setAttribute("aria-pressed", String(selectedNetworkBranch === branch.id));
    const showWhy = document.body.dataset.mode === "demo";
    const boosters = branch.gridBoosters.map(item => `<div class="branch-booster-station" draggable="true" data-booster-id="${item.id}"><span>⚡</span><b>${item.id} · GRIDBOOSTER</b><small>IN ${fmt(item.inletTemp)} °C → OUT ${fmt(item.outletTemp)} °C</small><small>LIFT +${fmt(item.actualLiftK)} K · ${fmt(item.thermalPowerKW)} kWth</small><small>ELECTRIC ${fmt(item.electricalPowerKW)} kWe · COP ${fmt(item.cop, 2)}</small><small>MAX ${fmt(item.maxThermalKW)} kWth · ${item.capacitySufficient ? "✓ CAPACITY OK" : `! UNDERSIZED · ${fmt(item.requestedPowerKW - item.thermalPowerKW)} kWth short`}</small>${showWhy ? `<button type="button" class="network-why-button" data-inspect-kind="booster" data-i18n="interaction.why">WHY?</button>` : ""}${branch.feasibleWithoutBooster ? `<small class="booster-note">Booster installed — branch already feasible without local lift.</small>` : ""}</div>`).join("");
    const duty = branch.boosterActive ? `ACTUAL LOCAL DUTY ${fmt(branch.boosterThermalPowerKW)} kWth · ${fmt(branch.boosterElectricalPowerKW)} kWe` : `REQUIRED / HYPOTHETICAL DUTY ${fmt(branch.requiredBoosterPowerKW)} kWth`;
    row.innerHTML = `<div class="branch-pipe-connector"><span>${branch.id <= "C" ? "▲" : "▼"}</span></div><div class="branch-route-card">
      <div class="branch-route-head"><b class="branch-flag">${branch.id}</b><strong>${escapeHtml(branch.name).toUpperCase()} · CUSTOMER LOAD</strong><span class="branch-status">${label}</span>${showWhy ? `<button type="button" class="network-why-button" data-why-branch="${branch.id}" data-i18n="interaction.why">WHY?</button>` : ""}</div>
      <div class="branch-route-values"><b class="branch-temp">TEMP CAPABILITY ${fmt(branch.availableSupplyTemp)} °C</b><span>MIN ${fmt(branch.minimumSupplyTemp)} °C</span><span>LOAD ${fmt(branch.demandKW / 1000, 2)} MWth</span><span>FLOW ${fmt(branch.flowM3h)} m³/h</span><span>HMP → BRANCH ΔT LOSS −${fmt(branch.lossToBranch)} K</span><span>CAPABILITY MARGIN ${fmt(branch.margin)} K</span><span>WITHOUT BOOSTER ${branch.feasibleWithoutBooster ? "✓ TEMP CAPABLE" : "! BELOW MINIMUM"}</span><span>${duty}</span></div>
      <div class="branch-drop-hint">DROP GRIDBOOSTER HERE · BASE CAPABILITY ${fmt(branch.availableSupplyTemp)} °C → BOOSTED CAPABILITY ${fmt(branch.finalSupplyTemp)} °C · MARGIN ${fmt(branch.finalMargin)} K</div>
    </div>${boosters}`;
    row.addEventListener("dragover", event => { event.preventDefault(); row.classList.add("drag-target"); });
    row.addEventListener("dragleave", () => row.classList.remove("drag-target"));
    row.addEventListener("drop", event => {
      event.preventDefault(); row.classList.remove("drag-target");
      const id = event.dataTransfer?.getData("text/plain");
      const item = gridBoosters.find(candidate => candidate.id === id);
      if (item) { assignBoosterBranch(item, branch.id); renderBoosterTray(); recalculate(); }
    });
    row.addEventListener("click", event => { if (!event.target.closest?.("button,select,input,[draggable='true']")) selectNetworkBranch(branch); });
    row.addEventListener("keydown", event => { if ((event.key === "Enter" || event.key === " ") && event.target === row) { event.preventDefault(); selectNetworkBranch(branch); } });
    row.querySelector("[data-why-branch]")?.addEventListener("click", event => { event.stopPropagation(); inspectBranch(branch); });
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
      <small>Temperature capability ${fmt(branch.finalSupplyTemp)} °C <i>·</i> Minimum ${fmt(branch.minimumSupplyTemp)} °C <i>·</i> HMP-to-branch loss −${fmt(branch.lossToBranch)} K <i>·</i> Demand ${fmt(branch.demandKW / 1000, 2)} MWth <i>·</i> Flow ${fmt(branch.flowM3h)} m³/h <i>·</i> ${branch.boosterActive ? `Booster duty ${fmt(branch.boosterThermalPowerKW)} kWth / ${fmt(branch.boosterElectricalPowerKW)} kWe` : `Required / hypothetical booster duty ${fmt(branch.requiredBoosterPowerKW)} kWth`}</small>`;
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
  const pathNames = { "raw-return": "Raw waste heat → Return", "one-stage": "One-stage HP → Supply/HMP", "two-stage": "Two-stage HP → Supply/HMP" };
  const status = after.networkOperatingPointSupported ? "HMP SOURCE SUPPORTED" : after.hmpTemperatureReachable ? "SOURCE CAPACITY SHORTFALL" : "HMP TEMPERATURE UNSUPPORTED";
  const sourceUsed = after.dataCenterSourceHeatUsedKW, sourceAvailable = source.availableKW;
  const utilization = sourceAvailable > 0 ? sourceUsed / sourceAvailable * 100 : 0;
  const centralCost = calculateOperatingCost({ centralPlantKW: after.centralPlantUsedKW }, prices);
  const rawHeatCost = calculateOperatingCost({ wasteHeatKW: sourceUsed }, prices);
  const hpElectricCost = calculateOperatingCost({ electricPowerKW: after.dataCenterElectricPowerKW }, prices);
  const boosterElectricCost = calculateOperatingCost({ electricPowerKW: after.booster.electricalPowerKW }, prices);

  set("kpi-hmp-target", `${fmtTemp(after.hmpTargetTemp)} °C`);
  set("kpi-hmp", `${fmtTemp(after.hmpTargetTemp)} °C`);
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
    return `Branch ${branch.id}: ${fmtTemp(branch.finalSupplyTemp)} °C supply − ${fmtTemp(branch.returnTemp)} °C return = ${fmt(branch.branchDeltaK, 1)} K · Entered heat demand: ${fmt(branch.demandKW / 1000, 2)} MWth · Flow/ΔT implied heat: ${fmt((check?.impliedHeatKW ?? 0) / 1000, 2)} MWth · Difference: ${check?.differencePercent == null ? "—" : `${fmt(check.differencePercent, 1)}%`} · ${check?.status ?? "CHECK INPUTS"}`;
  }).join(" · ");
  renderSourceBlending(after);
  const mode = $("dc-mode").value;
  $("dc-return-limit-field").hidden = mode !== "raw-return";
  const casualAssumption = $("casual-hp-assumption");
  casualAssumption.hidden = document.body.dataset.mode !== "casual" || mode === "raw-return";
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
  host.textContent = `Available data-center heat ${fmt(blend.availableDataCenterHeatKW / 1000, 2)} MWth · selected ${fmt(blend.selectedDataCenterHeatKW / 1000, 2)} MWth (${fmt(blend.dataCenterSourceUtilizationPercent, 1)}%) · Plant contribution ${fmt(blend.plantContributionTemp)} °C at HMP · data-center contribution ${fmt(blend.dataCenterContributionTemp)} °C at HMP · plant ${fmt(blend.plantThermalKW / 1000, 2)} MWth / ${fmt(blend.plantFlowM3h)} m³/h · data center ${fmt(blend.dataCenterThermalKW / 1000, 2)} MWth / ${fmt(blend.dataCenterFlowM3h)} m³/h · mixed ${fmt(blend.mixedSupplyTemp)} °C vs HMP target ${fmt(blend.hmpTargetTemp)} °C · required plant outlet ${fmt(blend.requiredPlantSupplyTemp)} °C · ramp +${fmt(blend.plantRampK)} K · ramp limit ${fmt(blend.rampLimitSupplyTemp)} °C · strict ${fmt(blend.strictCostPerHour, 2)} €/h · blended ${fmt(blend.blendedCostPerHour, 2)} €/h · difference ${fmt(blend.differencePerHour, 2)} €/h · ramp penalty ${fmt(blend.rampPenaltyPerHour, 2)} €/h · ${blend.status}`;
}

function renderDataCenterModes(result) {
  const after = result.withBooster;
  const host = $("data-center-mode-comparison"); host.replaceChildren();
  const prices = flexPrices();
  for (const [key, title] of [["raw-return", "RAW WASTE HEAT → RETURN"], ["one-stage", "ONE-STAGE HP → SUPPLY/HMP"], ["two-stage", "TWO-STAGE HP → SUPPLY/HMP"]]) {
    const mode = after.sourceBlending?.selected && after.wasteHeat.mode === key ? after.wasteHeat : after.dataCenterModes[key], card = document.createElement("article");
    const strictEligible = mode.strictTemperatureEligible ?? mode.injectionEligible;
    const blendedAccepted = after.sourceBlending?.selected && after.wasteHeat.mode === key && mode.usedViaBlending;
    const routeActive = after.wasteHeat.mode === key;
    card.className = `dc-mode-card ${routeActive || strictEligible || blendedAccepted ? "injectable" : "blocked"}${routeActive ? " active" : ""}`;
    const status = key === "raw-return" ? "RAW SOURCE · RETURN ONLY · 0 kW INJECTED AT HMP"
      : mode.temperatureRangeAvailable === false ? (key === "one-stage" ? "⛔ NO ONE-STAGE RANGE · RAW + 5 K EXCEEDS 75°C" : "⛔ NO TWO-STAGE RANGE · RAW EXCEEDS 85°C")
      : blendedAccepted ? `STRICTLY BLOCKED · USED VIA BLENDED SOURCE OPERATION · ${fmt(mode.injectedKW)} kWth INJECTED`
      : strictEligible ? `✓ ${fmt(mode.contributionTemp)} °C AFTER LOSS > ${fmt(after.hmpTargetTemp)} °C HMP · ${fmt(mode.injectedKW)} kWth INJECTED`
        : `⛔ ${fmt(mode.contributionTemp)} °C AFTER LOSS ≤ ${fmt(after.hmpTargetTemp)} °C HMP · STRICTLY BLOCKED`;
    const stageRows = mode.stages.map((stage, index) => `<div><span>Stage ${index + 1} · ${fmt(stage.outletTemp)} °C</span><b>Source ${fmt(stage.sourceHeatKW)} kWth + electric ${fmt(stage.electricalPowerKW)} kWe = ${fmt(stage.deliveredHeatKW)} kWth</b></div>${stage.noUpgradeRequired ? `<small class="dc-no-upgrade">NO UPGRADE REQUIRED · ${fmt(stage.inletTemp)} °C source already meets the ${fmt(stage.requestedOutletTemp)} °C target.</small>` : ""}`).join("");
    const operatingCost = calculateOperatingCost({ wasteHeatKW: mode.sourceHeatKW, electricPowerKW: mode.electricalPowerKW }, prices);
    const deliveredHeatCost = mode.deliveredHeatKW > 0 ? operatingCost / (mode.deliveredHeatKW / 1000) : null;
    const outlet = mode.outletTemp == null ? "NO VALID RANGE" : `${fmt(mode.outletTemp)} °C`;
    const atHMP = mode.contributionTemp == null ? "—" : `${fmt(mode.contributionTemp)} °C`;
    card.innerHTML = `<header><b>${title}</b><span>${after.wasteHeat.mode === key ? "SELECTED MODE" : "COMPARE"}</span></header><strong class="dc-mode-status">${status}</strong>${key !== "raw-return" && mode.noUpgradeRequired ? `<p class="dc-no-upgrade">NO UPGRADE REQUIRED · Source temperature already meets the requested heat-pump outlet target.</p>` : ""}<div class="dc-mode-values"><div><span>Outlet before loss</span><b>${outlet}</b></div><div><span>${key === "raw-return" ? "HMP contribution" : "Delivered at HMP"}</span><b>${key === "raw-return" ? "0.0 kWth" : atHMP}</b></div><div><span>Connection loss</span><b>${key === "raw-return" ? "Not applicable" : `−${fmt(mode.lossToHMP)} K`}</b></div><div><span>Raw source heat</span><b>${fmt(mode.sourceHeatKW)} kWth</b></div>${stageRows}<div><span>Electric input</span><b>${fmt(mode.electricalPowerKW)} kWe</b></div><div><span>Heat-pump delivered heat</span><b>${fmt(mode.deliveredHeatKW)} kWth</b></div><div><span>${key === "raw-return" ? "HMP heat injected" : "Heat injected"}</span><b>${fmt(mode.injectedKW)} kWth</b></div><div><span>Total COP</span><b>${mode.totalCOP == null ? "—" : fmt(mode.totalCOP, 2)}</b></div><div><span>${key === "raw-return" ? "Supply route" : "Strict temperature eligibility"}</span><b>${key === "raw-return" ? "INACTIVE · RETURN ONLY" : strictEligible ? "STRICTLY ELIGIBLE" : blendedAccepted ? "STRICTLY BLOCKED · USED VIA BLENDING" : "STRICTLY BLOCKED"}</b></div><div><span>Theoretical operating cost</span><b>${fmt(operatingCost, 2)} €/h</b></div><div><span>Effective delivered heat cost</span><b>${deliveredHeatCost == null ? "—" : `${fmt(deliveredHeatCost, 2)} €/MWh`}</b></div></div>`;
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
  { title: "BOOST LOCALLY. NOT EVERYWHERE.", copy: "Gridbooster lifts the selected branch to its required temperature. Activate it to see the network calculation update." },
  { title: "UNLOCK PREVIOUSLY INACCESSIBLE WASTE HEAT.", copy: "Compare the same demand, source, weather and plant assumptions. Only the HMP target and local booster configuration differ." },
  { title: "THE VALUE IS IN THE SYSTEM.", copy: "Compare avoided central production cost and net operating cost at this modeled operating point. Annual savings and payback need operating hours and investment data." }
];
let guidedDemoStep = 0;
const guidedDemoBooster = { id: "GB-DEMO", branchId: "", mode: "target", targetTemp: 85, liftK: 0, cop: 3, maxThermalKW: 900 };

function guidedDemoInputs(input, hmpTargetTemp, boosters) {
  return { ...input, hmpTargetTemp, gridBoosters: boosters.map(item => ({ ...item })) };
}

function guidedOperatingCost(state, prices) {
  return calculateOperatingCost({ centralPlantKW: state.centralPlantUsedKW,
    wasteHeatKW: state.dataCenterSourceHeatUsedKW,
    electricPowerKW: state.dataCenterElectricPowerKW + state.booster.electricalPowerKW }, prices)
    + Number(state.plantRampPenaltyPerHour ?? 0);
}

function renderGuidedDemo(input, result) {
  const step = guidedDemoSteps[guidedDemoStep];
  $("guided-demo-step-label").textContent = `STEP ${guidedDemoStep + 1} OF 5`;
  $("guided-demo-step-title").textContent = step.title;
  $("guided-demo-step-copy").textContent = step.copy;
  $("guided-demo-assumption").textContent = "Illustrative demonstration inputs · outputs are calculated by the simplified Gridbooster model, not measured or externally validated.";
  $("demo-annual-value").textContent = "Unavailable";
  $("demo-branch-prompt").hidden = guidedDemoStep !== 1;
  $("guided-demo-activate").hidden = guidedDemoStep !== 2 || demoConstraintAddressed;
  $("guided-demo-activate").disabled = !selectedNetworkBranch;
  const bottleneck = findPrimaryTemperatureBottleneck(latestNetworkState?.withBooster.afterBranches ?? []);
  if (guidedDemoStep === 1) $("demo-branch-feedback").textContent = !bottleneck
    ? translate("interaction.no_constraint")
    : selectedNetworkBranch === bottleneck.id && bottleneckFound
      ? translate("interaction.constraint_found", { branch: bottleneck.id, deficit: fmt(-bottleneck.finalMargin) })
      : selectedNetworkBranch ? translate("interaction.try_another") : "";
  else if (guidedDemoStep === 2 && demoConstraintAddressed)
    $("demo-branch-feedback").textContent = translate("interaction.constraint_addressed", { branch: selectedNetworkBranch });
  else if (guidedDemoStep === 2 && gridBoosters.length && bottleneck)
    $("demo-branch-feedback").textContent = translate("interaction.constraint_remains", { branch: gridBoosters[0].branchId, primary: bottleneck.id });
  else if (guidedDemoStep !== 1) $("demo-branch-feedback").textContent = "";
  $("demo-hmp-control").value = String(input.hmpTargetTemp);
  $("demo-hmp-value").textContent = `${fmt(Number(input.hmpTargetTemp))} °C`;
  $("demo-comparison-toggle").textContent = translate(demoComparisonBaseline ? "interaction.show_current" : "interaction.show_baseline");
  $("demo-comparison-toggle").setAttribute("aria-pressed", String(demoComparisonBaseline));
  $("demo-baseline-label").textContent = translate("interaction.baseline_label");
  $("demo-current-label").textContent = translate(gridBoosters.some(item => item.branchId) ? "interaction.current_with_booster" : "interaction.current_without_booster");
  $("guided-demo-back").disabled = guidedDemoStep === 0;
  $("guided-demo-next").disabled = guidedDemoStep === 1 && !bottleneckFound || guidedDemoStep === 2 && !demoConstraintAddressed;
  $("guided-demo-next").textContent = guidedDemoStep === 4 ? "RESTART ↻" : "NEXT →";
  document.querySelectorAll("[data-demo-goto]").forEach(button => {
    const active = Number(button.dataset.demoGoto) === guidedDemoStep;
    button.disabled = Number(button.dataset.demoGoto) === 2 && !bottleneckFound || Number(button.dataset.demoGoto) > 2 && !demoConstraintAddressed;
    button.classList.toggle("active", active);
    button.setAttribute("aria-current", active ? "step" : "false");
  });
  const prices = flexPrices();
  const baselineInput = guidedDemoInputs(input, 90, []);
  const optimizedInput = guidedDemoInputs(input, input.hmpTargetTemp, input.gridBoosters ?? []);
  try {
    const baseline = simulateNetwork(baselineInput, prices).withBooster;
    const optimized = simulateNetwork(optimizedInput, prices).withBooster;
    const additionalHeatKW = optimized.wasteHeatUsedKW - baseline.wasteHeatUsedKW;
    const avoidedCentralCost = (baseline.centralPlantUsedKW - optimized.centralPlantUsedKW) * Number(prices.centralHeatCostPerMWh ?? 40) / 1000;
    const netBenefit = guidedOperatingCost(baseline, prices) - guidedOperatingCost(optimized, prices);
    const comparisonRows = [
      ["Central plant supply temperature", `${fmtTemp(baseline.centralPlant.supplyTemp)} °C`, `${fmtTemp(optimized.centralPlant.supplyTemp)} °C`],
      ["Central HMP target", `${fmtTemp(baseline.hmpTargetTemp)} °C`, `${fmtTemp(optimized.hmpTargetTemp)} °C`],
      ["Branches meeting minimum temperature", `${baseline.feasibleAfterCount} / 6`, `${optimized.feasibleAfterCount} / 6`],
      ["Available waste heat source", `${fmt(baseline.wasteHeat.availableKW / 1000, 2)} MWth`, `${fmt(optimized.wasteHeat.availableKW / 1000, 2)} MWth`],
      ["Waste heat utilized", `${fmt(baseline.wasteHeatUsedKW / 1000, 2)} MWth`, `${fmt(optimized.wasteHeatUsedKW / 1000, 2)} MWth`],
      ["Central heat production", `${fmt(baseline.centralProductionKW / 1000, 2)} MWth`, `${fmt(optimized.centralProductionKW / 1000, 2)} MWth`],
      ["Gridbooster electricity", "0 kWe", `${fmt(optimized.booster.electricalPowerKW)} kWe`],
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
  const destination = Math.max(0, Math.min(step, guidedDemoSteps.length - 1));
  if (destination >= 2 && !bottleneckFound || destination >= 3 && !demoConstraintAddressed) return;
  guidedDemoStep = destination;
  renderBoosterTray();
  recalculate();
}

function restartGuidedDemo() {
  loadScenario(0);
  $("dc-temp").value = "83";
  $("dc-mode").value = "two-stage";
  $("scenario-description").textContent = "Illustrative guided case: compare a 90 °C baseline with an 80 °C HMP target, using the same 83 °C data-center waste-heat source and a local booster on Branch A.";
  selectedNetworkBranch = "";
  bottleneckFound = false;
  demoConstraintAddressed = false;
  demoComparisonBaseline = false;
  gridBoosters = [];
  $("hmp-target").value = "90";
  $("hmp-target-slider").value = "90";
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
      svgNode(marker, "title", {}, `${displaySourceStatus(point.operatingPointStatus)} · ${fmtTemp(point.hmpTargetTemp)} °C HMP`);
    }
  });
  for (const point of [points[0], points[Math.floor((points.length - 1) / 2)], points.at(-1)])
    svgNode(svg, "text", { x: x(point.hmpTargetTemp), y: 174, "text-anchor": "middle", class: "flex-axis-label" }, `${fmtTemp(point.hmpTargetTemp)}°`);
  svgNode(svg, "text", { x: right, y: 188, "text-anchor": "end", class: "flex-unit-label" }, "HMP TARGET · °C");
}

function renderFlexSummary(point) {
  const cards = [
    ["HMP TARGET", `${fmt(point.hmpTargetTemp)} °C · ${point.operatingPointStatus}`, `${fmt(point.hmpTemperatureCapabilityTemp)} °C temperature capability · ${point.hmpTemperatureReachable ? `thermal shortfall ${fmt(point.thermalShortfallKW)} kW` : "target temperature not reachable"}`],
    ["BRANCHES", `${point.feasibleBranchesWithoutBooster} FEASIBLE · ${point.branchesRequiringBooster} NEED BOOST`, `${point.activeBoosterCount} active · ${point.installedBoosterCount} installed Gridbooster(s)`],
    ["WASTE HEAT", `${fmt(point.usableDataCenterHeatKW)} kW`, `${point.selectedDataCenterMode.toUpperCase()} · ${point.selectedDataCenterPathUsedViaBlending ? "STRICTLY BLOCKED · USED VIA BLENDING" : point.selectedDataCenterPathEligible ? point.selectedDataCenterPathUsed ? "STRICTLY ELIGIBLE · USED" : "STRICTLY ELIGIBLE · NOT USED" : "STRICTLY BLOCKED"}`],
    ["CENTRAL PLANT", `${fmt(point.centralPlantRequiredKW)} kWth`, `${fmt(point.centralPlantActualKW)} kWth actual · ${fmt(point.centralPlantShortfallKW)} kWth short`],
    ["INSTALLED BOOSTERS", `${fmt(point.installedBoosterThermalKW)} kWth`, `${fmt(point.installedBoosterElectricKW)} kWe actual input`],
    ["HYPOTHETICAL DUTY", `${fmt(point.additionalRequiredBoosterThermalKW)} kWth`, `${fmt(point.additionalRequiredBoosterElectricKW)} kWe if all unmet branches were boosted`],
    ["DATA-CENTER HP", `${fmt(point.dataCenterElectricKW)} kWe`, `${fmt(point.dataCenterDeliveredHeatKW)} kWth delivered · ${fmt(point.dataCenterInjectedHeatKW)} kWth injected · combined COP ${point.dataCenterTotalCOP == null ? "—" : fmt(point.dataCenterTotalCOP, 2)}`],
    ["TOTAL ELECTRICITY", `${fmt(point.totalSystemElectricKW)} kWe`, `Data-center HP + installed Gridboosters`],
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
  const pathPoints = [["raw-return", "RAW WASTE HEAT → RETURN · SUPPLY CONTRIBUTION:"], ["one-stage", "ONE-STAGE HEAT PUMP USABLE UP TO:"], ["two-stage", "TWO-STAGE HEAT PUMP USABLE UP TO:"]]
    .map(([mode, label]) => {
      const eligible = points.filter(point => point.dataCenterModeEligibility[mode]);
      const value = !eligible.length ? "BLOCKED ACROSS SWEEP" : eligible.length === points.length
        ? "AVAILABLE ACROSS SWEEP" : `${fmtTemp(eligible.at(-1).hmpTargetTemp)} °C HMP`;
      return [label, value];
    });
  const keyPoints = [
    ["ALL BRANCHES FEASIBLE WITHOUT BOOST:", allBranches ? `${fmtTemp(allBranches.hmpTargetTemp)} °C HMP` : "NO HMP SOURCE SUPPORTED POINT"],
    ["BOOSTERS FIRST REQUIRED BELOW:", boostTransition ? `${fmtTemp(boostTransition.hmpTargetTemp)} °C HMP` : "NO HMP SOURCE SUPPORTED POINT"],
    ...pathPoints,
    ["LOWEST TOTAL ELECTRICITY POINT:", minElectric ? `${fmtTemp(minElectric.hmpTargetTemp)} °C HMP` : "NO HMP SOURCE SUPPORTED POINT"],
    ["LOWEST CENTRAL PRODUCTION POINT:", minCentral ? `${fmtTemp(minCentral.hmpTargetTemp)} °C HMP` : "NO HMP SOURCE SUPPORTED POINT"],
    ["LOWEST OPERATING COST POINT:", minCost ? `${fmtTemp(minCost.hmpTargetTemp)} °C HMP` : "NO HMP SOURCE SUPPORTED POINT"]
  ];
  $("flex-key-points").innerHTML = keyPoints.map(([label, value]) => `<div class="key-point"><span>${label}</span><b>${value}</b></div>`).join("");
  const currentPoint = points.reduce((best, point) => Math.abs(point.hmpTargetTemp - currentHmp) < Math.abs(best.hmpTargetTemp - currentHmp) ? point : best, points[0]);
  const suggestions = [[`Current HMP${currentPoint.operatingPointStatus === "SUPPORTED" ? "" : ` · ${displaySourceStatus(currentPoint.operatingPointStatus)}`}`, Number(currentHmp)],
    ["First-booster threshold", boostTransition?.hmpTargetTemp], ["Lowest electricity", minElectric?.hmpTargetTemp], ["Lowest operating cost", minCost?.hmpTargetTemp]];
  const unique = [...new Map(suggestions.filter(([, value]) => Number.isFinite(value)).map(([label, value]) => [value, [label, value]])).values()];
  const host = $("recommended-comparison-buttons");
  host.innerHTML = unique.map(([label, value]) => `<button type="button" data-add-comparison="${value}">${label} · ${fmtTemp(value)} °C ＋</button>`).join("");
  host.querySelectorAll("[data-add-comparison]").forEach(button => button.addEventListener("click", () => addComparisonTarget(button.dataset.addComparison)));
}

function renderFlexZones(points) {
  const min = points[0].hmpTargetTemp, max = points.at(-1).hmpTargetTemp;
  const rows = [["raw-return", "RAW RETURN"], ["one-stage", "ONE-STAGE SUPPLY"], ["two-stage", "TWO-STAGE SUPPLY"]].map(([mode, label]) => {
    const eligible = points.filter(point => point.dataCenterModeEligibility[mode]);
    let detail = "Strictly blocked across this sweep";
    let start = 0, width = 0;
    if (eligible.length) {
      const low = eligible[0].hmpTargetTemp, high = eligible.at(-1).hmpTargetTemp;
      detail = `${fmtTemp(low)}–${fmtTemp(high)} °C HMP · strictly eligible after connection loss`;
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
    return `<span class="${item.feasibleWithoutBooster ? "band-feasible" : "band-below"}" title="${fmt(item.availableSupplyTemp)} °C available · ${fmt(item.minimumSupplyTemp)} °C minimum">${item.feasibleWithoutBooster ? "✓" : `−${fmt(item.requiredLift, 0)}`}</span>`;
  }).join("")}</div>`).join("");
  $("flex-branch-bands").innerHTML = `<div class="branch-band-wrap">${head}${rows}</div><small class="band-note">✓ temperature capable · −K indicates required local lift · fixed HMP-to-branch loss applied</small>`;
}

function renderComparisonChips() {
  const host = $("comparison-temp-chips");
  host.innerHTML = comparisonTargets.map(value => `<button type="button" class="comparison-chip" data-remove-temp="${value}">${fmt(value, 1)} °C <b aria-hidden="true">×</b></button>`).join("");
  host.querySelectorAll("[data-remove-temp]").forEach(button => button.addEventListener("click", () => {
    comparisonTargets = comparisonTargets.filter(value => value !== Number(button.dataset.removeTemp));
    renderComparisonChips(); recalculate();
  }));
}

function renderStrategyTable(input, prices) {
  const values = [...new Set(comparisonTargets)].sort((a, b) => a - b);
  const points = calculateTemperatureFlexSweep(input, values, prices);
  const columnStatus = point => point.operatingPointStatus === "SUPPORTED" ? "" : `unsupported-column ${point.operatingPointStatus === "CAPACITY SHORTFALL" ? "capacity-column" : "temperature-column"}`;
  $("strategy-table-head").innerHTML = `<tr><th>METRIC</th>${points.map(point => `<th class="${columnStatus(point)}" title="${displaySourceStatus(point.operatingPointStatus)}">HMP ${fmt(point.hmpTargetTemp, 1)} °C<small>${displaySourceStatus(point.operatingPointStatus)}</small></th>`).join("")}</tr>`;
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
    ["Installed Gridbooster duty · kWth", point => point.installedBoosterThermalKW],
    ["Additional hypothetical duty · kWth", point => point.additionalRequiredBoosterThermalKW],
    ["Gridbooster electricity · kWe", point => point.installedBoosterElectricKW],
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

function opportunityTypeLabel(type) {
  return translate(({ "branch-temperature": "analysis.branch_temperature", "source-temperature": "analysis.source_temperature",
    "source-capacity": "analysis.source_capacity", "return-topology": "analysis.return_topology", none: "analysis.no_active_constraint" })[type] ?? "analysis.no_active_constraint");
}

function opportunityCostMarkup(benefitPerHour) {
  if (typeof benefitPerHour !== "number" || !Number.isFinite(benefitPerHour)) return "";
  if (Math.abs(benefitPerHour) < 0.005) return `<span>${escapeHtml(translate("analysis.no_material_cost_change"))}</span>`;
  const label = benefitPerHour > 0 ? "analysis.operating_benefit" : "analysis.operating_cost_increase";
  return `<span>${escapeHtml(translate(label))}: <strong>+€${fmt(Math.abs(benefitPerHour), 2)}/h</strong></span>`;
}

function opportunityMetricMarkup(metrics) {
  const heatToleranceKW = 5;
  const electricityToleranceKW = 0.05;
  const rows = [];
  if (typeof metrics.additionalUsableHeatKW === "number" && metrics.additionalUsableHeatKW >= heatToleranceKW) {
    rows.push(`<span>${escapeHtml(translate("analysis.additional_heat"))}: <strong>+${fmt(metrics.additionalUsableHeatKW / 1000, 2)} MWth</strong></span>`);
  }
  if (typeof metrics.centralProductionReductionKW === "number" && metrics.centralProductionReductionKW >= heatToleranceKW) {
    rows.push(`<span>${escapeHtml(translate("analysis.central_reduction"))}: <strong>−${fmt(metrics.centralProductionReductionKW / 1000, 2)} MWth</strong></span>`);
  }
  if (typeof metrics.additionalElectricityKW === "number" && metrics.additionalElectricityKW >= electricityToleranceKW) {
    rows.push(`<span>${escapeHtml(translate("analysis.additional_electricity"))}: <strong>+${fmt(metrics.additionalElectricityKW)} kWe</strong></span>`);
  }
  rows.push(opportunityCostMarkup(metrics.operatingBenefitPerHour));
  return rows.filter(Boolean).join("");
}

function renderOpportunitySummary(input, result, prices) {
  const mode = document.body.dataset.mode;
  if (!["casual", "engineer"].includes(mode)) return;
  const summary = analyzeSystemOpportunity(input, result);
  const intervention = calculateOpportunityIntervention(input, result, prices);
  const primary = summary.primary;
  const sourceIntervention = primary.type === "source-temperature" ? calculateSourceTemperatureIntervention(input, result, prices) : null;
  let detail = translate("analysis.no_active_constraint");
  let action = translate("analysis.none");
  if (primary.type === "branch-temperature") {
    const branch = input.branches.find(item => item.id === primary.branchId);
    detail = `${primary.branchId} · ${escapeHtml(branchName(branch ?? { id: primary.branchId, name: primary.branchName }))}<br>${escapeHtml(translate("analysis.available_required_deficit", {
      available: fmtTemp(primary.availableTempC), required: fmtTemp(primary.requiredTempC), deficit: fmt(primary.deficitK, 1)
    }))}`;
    action = translate(intervention.resolved ? "analysis.gridbooster_resolves" : "analysis.gridbooster_insufficient");
    action += ` ${translate("analysis.gridbooster_action", { branch: primary.branchId, duty: fmt(primary.requiredDutyKW ?? 0) })}`;
  } else if (primary.type === "source-temperature") {
    detail = escapeHtml(translate("analysis.source_shortfall", { capability: fmtTemp(primary.capabilityTempC), target: fmtTemp(primary.targetTempC), shortfall: fmt(primary.shortfallK, 1) }));
    const modes = result.withBooster.dataCenterModes ?? {};
    const alternateAvailable = ["one-stage", "two-stage"].some(key => key !== input.wasteHeat.mode && modes[key]?.injectionEligible);
    action = translate(alternateAvailable ? "analysis.source_upgrade_action" : "analysis.lower_hmp_action");
  } else if (primary.type === "source-capacity") {
    detail = escapeHtml(translate("analysis.capacity_shortfall", { shortfall: fmt(primary.shortfallKW, 0) }));
    action = translate("analysis.capacity_action");
  } else if (primary.type === "return-topology") {
    detail = escapeHtml(translate("analysis.return_blocked", { source: primary.sourceId, consumer: primary.consumerId }));
    action = translate("analysis.topology_action", { source: primary.sourceId, consumer: primary.consumerId });
  }

  const valueToleranceKW = 5;
  const hasSystemValue = metrics => (Number(metrics.additionalUsableHeatKW) > valueToleranceKW
    || Number(metrics.centralProductionReductionKW) > valueToleranceKW
    || Number(metrics.operatingBenefitPerHour) > 0.005);
  const branchFeasibilityMarkup = `<span>${escapeHtml(translate("analysis.branch_feasibility"))}: <strong>${escapeHtml(translate("analysis.branch_becomes_feasible", { branch: primary.branchId }))}</strong></span>`;
  const interventionDutyMarkup = typeof intervention.requiredDutyKW === "number" && Number.isFinite(intervention.requiredDutyKW)
    ? `<span>${escapeHtml(translate("analysis.required_gridbooster_duty"))}: <strong>${fmt(intervention.requiredDutyKW)} kWth</strong></span>` : "";
  const interventionElectricityMarkup = typeof intervention.additionalElectricityKW === "number" && intervention.additionalElectricityKW >= 0.05
    ? `<span>${escapeHtml(translate("analysis.additional_electricity"))}: <strong>+${fmt(intervention.additionalElectricityKW)} kWe</strong></span>` : "";
  const valueMarkup = primary.type === "branch-temperature" && intervention.resolved
    ? hasSystemValue(intervention)
      ? `<div class="opportunity-value"><b>${escapeHtml(translate("analysis.system_value"))}</b>${opportunityMetricMarkup(intervention)}</div>`
      : `<div class="opportunity-value intervention-impact"><b>${escapeHtml(translate("analysis.intervention_impact"))}</b>${branchFeasibilityMarkup}${interventionDutyMarkup}${interventionElectricityMarkup}${opportunityCostMarkup(intervention.operatingBenefitPerHour)}<span>${escapeHtml(translate("analysis.no_additional_heat_unlocked"))}</span></div>`
    : primary.type === "source-temperature" && sourceIntervention && sourceIntervention.additionalUsableHeatKW >= valueToleranceKW
      ? `<div class="opportunity-value"><b>${escapeHtml(translate("analysis.system_value"))}</b><small>${escapeHtml(translate("analysis.value_if_lowered_to", { temperature: fmtTemp(sourceIntervention.hmpTargetTemp) }))}</small>${opportunityMetricMarkup(sourceIntervention)}</div>`
      : "";
  const casualImpactMarkup = primary.type === "branch-temperature" && intervention.resolved && !hasSystemValue(intervention)
    ? `<div class="opportunity-value intervention-impact"><b>${escapeHtml(translate("analysis.intervention_impact"))}</b>${branchFeasibilityMarkup}${interventionElectricityMarkup}${opportunityCostMarkup(intervention.operatingBenefitPerHour)}</div>` : valueMarkup;
  const actionMarkup = primary.type === "none" ? "" : `<section><span>${escapeHtml(translate("analysis.local_action"))}</span><b>${escapeHtml(action)}</b></section>`;
  $("opportunity-casual").innerHTML = `<div class="opportunity-compact"><section><span>${escapeHtml(translate("analysis.primary_constraint"))}</span><b>${escapeHtml(opportunityTypeLabel(primary.type))}</b><p>${detail}</p></section>${actionMarkup}${casualImpactMarkup}</div>`;

  const allConstraints = summary.constraints.length ? summary.constraints.map(item => {
    if (item.type === "branch-temperature") return `<li><b>${escapeHtml(opportunityTypeLabel(item.type))} · ${item.branchId}</b><span>${fmtTemp(item.availableTempC)} °C → ${fmtTemp(item.requiredTempC)} °C · ${fmt(item.deficitK, 1)} K</span></li>`;
    if (item.type === "source-temperature") return `<li><b>${escapeHtml(opportunityTypeLabel(item.type))}</b><span>${fmtTemp(item.capabilityTempC)} °C capability · ${fmtTemp(item.targetTempC)} °C target · ${fmt(item.shortfallK, 1)} K short</span></li>`;
    if (item.type === "source-capacity") return `<li><b>${escapeHtml(opportunityTypeLabel(item.type))}</b><span>${fmt(item.shortfallKW, 0)} kW short</span></li>`;
    return `<li><b>${escapeHtml(opportunityTypeLabel(item.type))}</b><span>${escapeHtml(item.sourceId)} → ${escapeHtml(item.consumerId)}</span></li>`;
  }).join("") : `<li><b>${escapeHtml(translate("analysis.no_active_constraint"))}</b></li>`;
  $("opportunity-engineer").innerHTML = `<div class="opportunity-engineering"><section><span>${escapeHtml(translate("analysis.primary_constraint"))}</span><b>${escapeHtml(opportunityTypeLabel(primary.type))}</b><p>${detail}</p>${primary.type === "none" ? "" : `<small>${escapeHtml(action)}</small>`}</section><section><span>${escapeHtml(translate("analysis.primary_bottleneck"))}</span><ul>${allConstraints}</ul></section>${valueMarkup}</div>`;
}

const scenarioSlotNames = ["baseline", "optionA", "optionB"];
const scenarioSlotLabel = name => translate(`analysis.${name === "baseline" ? "baseline" : name === "optionA" ? "option_a" : "option_b"}`);

function setControlValue(id, value) {
  const element = document.getElementById(id);
  if (element && value != null) element.value = String(value);
}

function loadSnapshot(snapshot) {
  const { input, prices } = restoreScenarioSnapshot(snapshot);
  const direct = { "hmp-target": input.hmpTargetTemp, "outdoor-temp": input.outdoorTemp, "network-return-temp": input.networkReturnTemp,
    "network-reference-delta": input.referenceNetworkDeltaK ?? "", "source-temperature-strategy": input.sourceTemperatureStrategy,
    "normal-plant-supply": input.normalPlantSupplyTemp, "max-ramped-plant-supply": input.maxRampedPlantSupplyTemp,
    "plant-ramp-cost": input.plantRampCostPerMWhPerK,
    "plant-temp": input.centralPlant.supplyTemp, "plant-power": input.centralPlant.maxPowerMW,
    "plant-availability": input.centralPlant.availabilityPercent, "plant-loss": input.centralPlant.lossToHMP,
    "dc-temp": input.wasteHeat.injectionTemp, "dc-power": input.wasteHeat.maxPowerMW, "dc-availability": input.wasteHeat.availabilityPercent,
    "dc-loss": input.wasteHeat.lossToHMP, "dc-mode": input.wasteHeat.mode, "dc-single-temp": input.wasteHeat.singleStageOutletTemp,
    "dc-single-cop": input.wasteHeat.singleStageCOP, "dc-stage1-temp": input.wasteHeat.stage1OutletTemp, "dc-stage1-cop": input.wasteHeat.stage1COP,
    "dc-stage2-temp": input.wasteHeat.stage2OutletTemp, "dc-stage2-cop": input.wasteHeat.stage2COP,
    "booster-branch": input.booster.branchId, "booster-mode": input.booster.mode,
    "booster-setpoint": input.booster.mode === "target" ? input.booster.targetTemp : input.booster.liftK,
    "network-cop": input.booster.cop, "booster-capacity": input.booster.maxThermalKW,
    "central-heat-cost": prices.centralHeatCostPerMWh, "electricity-price": prices.electricityPricePerMWh,
    "waste-heat-cost": prices.wasteHeatCostPerMWh };
  for (const [id, value] of Object.entries(direct)) setControlValue(id, value);
  for (const field of branchControls.querySelectorAll("input[data-branch][data-key]")) {
    const branch = input.branches.find(item => item.id === field.dataset.branch);
    if (branch && Object.hasOwn(branch, field.dataset.key)) field.value = branch[field.dataset.key] ?? "";
  }
  const nodeById = new Map((input.returnNetwork?.nodes ?? []).map(node => [node.id, node]));
  const returnControlMap = { "return-base-temp": input.returnNetwork?.baseReturnTempC, "return-flow": input.returnNetwork?.returnFlowM3h,
    "dc-return-order": nodeById.get("DC-RETURN")?.order, "dc-return-max-injection": nodeById.get("DC-RETURN")?.maxInjectionKW,
    "sm-enabled": nodeById.get("SM-1")?.enabled === false ? "false" : "true", "sm-order": nodeById.get("SM-1")?.order,
    "sm-temp": nodeById.get("SM-1")?.sourceTempC, "sm-power": nodeById.get("SM-1")?.availableKW, "sm-max-injection": nodeById.get("SM-1")?.maxInjectionKW };
  for (const id of ["D", "E", "F"]) {
    const node = nodeById.get(id), lower = id.toLowerCase();
    returnControlMap[`pip3-${lower}-order`] = node?.order;
    returnControlMap[`pip3-${lower}-min-temp`] = node?.minimumUsableTempC;
    returnControlMap[`pip3-${lower}-max-uptake`] = node?.maxUptakeKW;
  }
  for (const [id, value] of Object.entries(returnControlMap)) setControlValue(id, value);
  const dcReturn = nodeById.get("DC-RETURN");
  if (dcReturn) setControlValue("dc-return-max-injection", dcReturn.maxInjectionKW);
  gridBoosters = (input.gridBoosters ?? []).map(item => ({ ...item }));
  nextBoosterId = Math.max(1, ...gridBoosters.map(item => {
    const match = String(item.id).match(/^GB-(\d+)$/); return match ? Number(match[1]) + 1 : 1;
  }));
  renderBoosterTray(); recalculate();
}

function saveScenarioSnapshot(slot, update = false) {
  scenarioSnapshots = saveScenarioSlot(scenarioSnapshots, slot, readScenario(), flexPrices(), new Date().toISOString());
  renderScenarioSnapshots();
}

function renderScenarioSnapshots() {
  const host = $("scenario-snapshot-slots"); host.replaceChildren();
  for (const slot of scenarioSlotNames) {
    const snapshot = scenarioSnapshots[slot];
    const card = document.createElement("article"); card.className = "scenario-slot";
    const name = scenarioSlotLabel(slot);
    const actions = snapshot
      ? `<button type="button" data-scenario-action="load" data-scenario-slot="${slot}">${escapeHtml(translate("analysis.load"))}</button><button type="button" data-scenario-action="update" data-scenario-slot="${slot}">${escapeHtml(translate("analysis.update"))}</button><button type="button" data-scenario-action="clear" data-scenario-slot="${slot}">${escapeHtml(translate("analysis.clear"))}</button>`
      : `<button type="button" data-scenario-action="save" data-scenario-slot="${slot}">${escapeHtml(translate("analysis.save_current"))}</button>`;
    card.innerHTML = `<b>${escapeHtml(name)}</b><small>${escapeHtml(snapshot ? translate("analysis.saved") : translate("analysis.empty_slot"))}</small><div>${actions}</div>`;
    host.append(card);
  }
  host.querySelectorAll("[data-scenario-action]").forEach(button => button.addEventListener("click", () => {
    const slot = button.dataset.scenarioSlot, action = button.dataset.scenarioAction;
    if (action === "save" || action === "update") saveScenarioSnapshot(slot, action === "update");
    else if (action === "clear") { scenarioSnapshots = clearScenarioSlot(scenarioSnapshots, slot); renderScenarioSnapshots(); }
    else if (action === "load" && scenarioSnapshots[slot]) loadSnapshot(scenarioSnapshots[slot]);
  }));
  const comparison = compareScenarioSnapshots(scenarioSnapshots);
  const warning = $("scenario-assumptions-warning");
  warning.hidden = comparison.assumptionsDiffer.length === 0;
  warning.innerHTML = comparison.assumptionsDiffer.length
    ? `<b>${escapeHtml(translate("analysis.assumptions_differ"))}</b><span>${comparison.assumptionsDiffer.map(field => escapeHtml(translate(`analysis.assumption.${field}`))).join(" · ")}</span>` : "";
  const rows = [
    ["analysis.hmp_target", "hmpTargetTemp", " °C"], ["analysis.primary_constraint_short", "primary", ""],
    ["analysis.feasible_branches", "feasibleBranches", " / 6"], ["analysis.branches_need_booster", "branchesRequiringBooster", ""],
    ["analysis.installed_boosters", "installedBoosterCount", ""], ["analysis.booster_duty", "installedBoosterThermalKW", " kWth"],
    ["analysis.booster_electricity", "installedBoosterElectricKW", " kWe"], ["analysis.data_center_mode", "dataCenterMode", ""],
    ["analysis.raw_return_heat", "rawReturnHeatKW", " kWth"], ["analysis.upgraded_supply_heat", "upgradedSupplyHeatKW", " kWth"],
    ["analysis.return_heat_recovered", "returnHeatKW", " kWth"], ["analysis.supply_top_up", "supplyTopUpKW", " kWth"],
    ["analysis.return_temp_plant", "returnTempAtPlantC", " °C"], ["analysis.central_production", "centralProductionKW", " kWth"],
    ["analysis.heat_pump_electricity", "heatPumpElectricKW", " kWe"], ["analysis.total_electricity", "totalElectricKW", " kWe"],
    ["analysis.operating_cost", "operatingCostPerHour", " €/h"], ["analysis.hmp_capability", "hmpTemperatureCapabilityTemp", " °C"],
    ["analysis.operating_point_supported", "operatingPointStatus", ""]
  ];
  $("scenario-snapshot-head").innerHTML = `<tr><th>${escapeHtml(translate("analysis.metric"))}</th>${scenarioSlotNames.map(slot => `<th>${escapeHtml(scenarioSlotLabel(slot))}</th>`).join("")}</tr>`;
  $("scenario-snapshot-body").innerHTML = rows.map(([label, key, unit]) => `<tr><th>${escapeHtml(translate(label))}</th>${scenarioSlotNames.map(slot => {
    const summary = comparison.summaries[slot]; if (!summary) return "<td>—</td>";
    let value = summary[key];
    if (key === "primary") {
      if (summary.primary.type === "branch-temperature") value = `${summary.primary.branchId} · ${fmt(summary.primary.deficitK, 1)} K`;
      else if (summary.primary.type === "source-temperature") value = `${opportunityTypeLabel(summary.primary.type)} · ${fmt(summary.primary.shortfallK ?? 0, 1)} K`;
      else if (summary.primary.type === "source-capacity") value = `${opportunityTypeLabel(summary.primary.type)} · ${fmt(summary.primary.shortfallKW, 0)} kW`;
      else if (summary.primary.type === "return-topology") value = `${summary.primary.sourceId} → ${summary.primary.consumerId}`;
      else value = opportunityTypeLabel(summary.primary.type);
    }
    if (key === "branchesRequiringBooster") value = value.length ? value.join(", ") : "—";
    if (typeof value === "number") value = fmt(value, key.includes("operatingCost") ? 2 : ["installedBoosterCount", "feasibleBranches"].includes(key) ? 0 : 1);
    if (key === "dataCenterMode") value = translate(({ "raw-return": "interaction.source_route_raw", "one-stage": "interaction.source_route_one", "two-stage": "interaction.source_route_two" })[value] ?? value);
    if (key === "operatingPointStatus") value = translate(({ SUPPORTED: "analysis.status_supported", "TEMPERATURE UNSUPPORTED": "analysis.status_temperature_unsupported", "CAPACITY SHORTFALL": "analysis.status_capacity_shortfall" })[value] ?? value);
    return `<td>${escapeHtml(value == null || value === "" ? "—" : `${value}${unit}`)}</td>`;
  }).join("")}</tr>`).join("");
  if (comparison.deltas.optionA || comparison.deltas.optionB) {
    const deltaRows = [["analysis.additional_heat", "usableWasteHeatKW", " kWth"], ["analysis.central_production", "centralProductionKW", " kWth"],
      ["analysis.total_electricity", "totalElectricKW", " kWe"], ["analysis.cost_saving_vs_baseline", "operatingCostSavingPerHour", " €/h"]];
    $("scenario-snapshot-body").innerHTML += deltaRows.map(([label, key, unit]) => `<tr class="scenario-delta-row"><th>${escapeHtml(translate(label))}</th><td>${escapeHtml(scenarioSlotLabel("baseline"))}</td>${["optionA", "optionB"].map(slot => {
      const delta = comparison.deltas[slot]?.[key];
      if (delta == null) return "<td>—</td>";
      const positiveBenefit = key === "operatingCostSavingPerHour" ? delta >= 0 : (key === "usableWasteHeatKW" ? delta >= 0 : key === "centralProductionKW" || key === "totalElectricKW" ? delta <= 0 : false);
      const value = key === "operatingCostSavingPerHour" && delta > 0 ? translate("analysis.saving_value", { value: fmt(delta, 2) })
        : key === "operatingCostSavingPerHour" && delta < 0 ? translate("analysis.cost_increase", { value: fmt(Math.abs(delta), 2) }) : fmt(delta, 2) + unit;
      return `<td class="${positiveBenefit ? "delta-benefit" : "delta-cost"}">${escapeHtml(value)}</td>`;
    }).join("")}</tr>`).join("");
  }
}

function renderMarginalTemperature(input, points, prices, currentTarget) {
  const start = Math.min(...points.map(point => Number(point.hmpTargetTemp)));
  const stepValue = Number($("sweep-step").value);
  const analysis = calculateMarginalTemperature(input, points.map(point => point.hmpTargetTemp), prices, currentTarget, start, points);
  const local = analysis.local;
  const rows = local ? [
    ["analysis.usable_heat_per_k", local.additionalUsableHeatKWPerK, " kWth/K"],
    ["analysis.central_per_k", local.centralProductionReductionKWPerK, " kWth/K"],
    ["analysis.electricity_per_k", local.additionalElectricityKWPerK, " kWe/K"],
    ["analysis.benefit_per_k", local.operatingBenefitPerHourPerK, " €/h/K"],
    ["analysis.booster_duty_per_k", local.gridboosterDutyChangeKWPerK, " kWth/K"]
  ] : [];
  const best = analysis.bestCost ? `<section class="best-sweep-point"><b>${escapeHtml(translate("analysis.lowest_cost_sweep"))}</b><strong>${fmtTemp(analysis.bestCost.hmpTargetTemp)} °C · ${fmt(analysis.bestCost.operatingCostPerHour, 2)} €/h</strong><small>${fmt(analysis.bestCost.usableWasteHeatKW / 1000, 2)} MWth ${escapeHtml(translate("analysis.additional_heat"))} · ${fmt(analysis.bestCost.gridboosterElectricKW)} kWe Gridbooster · ${analysis.bestCost.constrainedBranches} ${escapeHtml(translate("analysis.constrained_branches").toLowerCase())} · ${analysis.bestCost.boostedBranches} ${escapeHtml(translate("analysis.branches_need_booster").toLowerCase())}</small></section>`
    : `<p>${escapeHtml(translate("analysis.no_supported_point"))}</p>`;
  const thresholdEntries = [...(local?.events.length ? [{ temperatureC: local.lower.hmpTargetTemp, events: local.events }] : []), ...analysis.thresholds];
  const groupedThresholds = new Map();
  for (const item of thresholdEntries) {
    const key = Number(item.temperatureC).toFixed(5);
    if (!groupedThresholds.has(key)) groupedThresholds.set(key, { temperatureC: item.temperatureC, events: [] });
    groupedThresholds.get(key).events.push(...item.events);
  }
  const thresholdLines = [...groupedThresholds.values()].slice(0, 4).map(item => {
    const descriptions = item.events.map(event => {
      const key = event.type === "waste-heat" ? "analysis.next_waste_threshold" : event.type === "branch-constraint" ? "analysis.next_branch_constraint" : "analysis.next_booster_requirement";
      const value = event.type === "waste-heat" ? `+${fmt(event.deltaKW / 1000, 2)} MWth` : `Branch ${escapeHtml(event.branchId)}`;
      return `${escapeHtml(translate(key))} · ${value}`;
    });
    return `<li><b>${fmtTemp(item.temperatureC)} °C</b><span>${descriptions.join(" · ")}</span></li>`;
  }).join("");
  const gridRows = (local ? [{ hmpTargetTemp: local.current.hmpTargetTemp, heat: local.current.usableDataCenterHeatKW }, { hmpTargetTemp: local.lower.hmpTargetTemp, heat: local.lower.usableDataCenterHeatKW }] : [])
    .concat(points.filter(point => Number(point.hmpTargetTemp) < Number(local?.lower.hmpTargetTemp ?? currentTarget) - 1e-7).map(point => ({ hmpTargetTemp: point.hmpTargetTemp, heat: point.usableDataCenterHeatKW })))
    .sort((a, b) => Number(b.hmpTargetTemp) - Number(a.hmpTargetTemp)).filter((point, index, list) => !index || Math.abs(Number(point.hmpTargetTemp) - Number(list[index - 1].hmpTargetTemp)) > 1e-7).slice(0, 8).slice(0, -1).map((point, index, list) => {
    const next = list[index + 1]; if (!next) return "";
    const delta = Number(next.heat ?? 0) - Number(point.heat ?? 0);
    return `<div class="marginal-step-row"><b>${fmtTemp(point.hmpTargetTemp)} → ${fmtTemp(next.hmpTargetTemp)} °C</b><span>${delta > 1e-7 ? "+" : ""}${fmt(delta / 1000, 2)} MWth</span></div>`;
  }).join("");
  const changedMetrics = rows.filter(([, value]) => Number.isFinite(value) && Math.abs(value) > 1e-7);
  $("marginal-temperature-content").innerHTML = `<div class="marginal-local"><p><b>${escapeHtml(translate("analysis.current"))}</b> ${fmtTemp(currentTarget)} °C · <b>${escapeHtml(translate("analysis.next_lower"))}</b> ${local ? `${fmtTemp(local.lower.hmpTargetTemp)} °C` : "—"}</p>${local ? `${analysis.noChange ? `<strong class="no-marginal-change">${escapeHtml(translate("analysis.no_extra_heat", { step: fmt(local.deltaK, 1) }))}</strong>` : ""}${changedMetrics.length ? `<div class="marginal-metrics">${changedMetrics.map(([label, value, unit]) => `<div><span>${escapeHtml(translate(label))}</span><b>${fmt(value, 2)}${unit}</b></div>`).join("")}</div>` : ""}` : `<p>${escapeHtml(translate("analysis.no_next_lower"))} (${fmt(stepValue, 1)} K)</p>`}</div><div class="marginal-steps">${gridRows}</div><section class="threshold-list"><b>${escapeHtml(translate("analysis.next_waste_threshold"))} / ${escapeHtml(translate("analysis.next_branch_constraint"))}</b>${thresholdLines ? `<ul>${thresholdLines}</ul>` : `<p>${escapeHtml(translate("analysis.no_thresholds"))}</p>`}</section>${best}`;
}

const sensitivityMetricInfo = {
  operatingCost: { label: "sensitivity.metric.operating_cost", key: "operatingCost", unit: "€/h", digits: 2 },
  usableHeat: { label: "sensitivity.metric.usable_heat", key: "usableHeat", unit: "kWth", digits: 0 },
  centralProduction: { label: "sensitivity.metric.central_production", key: "centralProduction", unit: "kWth", digits: 0 },
  totalElectricity: { label: "sensitivity.metric.total_electricity", key: "totalElectricity", unit: "kWe", digits: 0 },
  boosterElectricity: { label: "sensitivity.metric.booster_electricity", key: "boosterElectricity", unit: "kWe", digits: 0 },
  boosterDuty: { label: "sensitivity.metric.booster_duty", key: "boosterDuty", unit: "kWth", digits: 0 },
  constrainedBranches: { label: "sensitivity.metric.constrained_branches", key: "constrainedBranches", unit: "", digits: 0 }
};
const sensitivityStatusKey = status => ({ SUPPORTED: "sensitivity.status_supported", "TEMPERATURE UNSUPPORTED": "sensitivity.status_temperature", "CAPACITY SHORTFALL": "sensitivity.status_capacity", INVALID: "sensitivity.invalid" })[status] ?? "sensitivity.invalid";
const sensitivityEventKey = type => ({ "source-eligibility": "sensitivity.source_becomes_usable", "branch-constraint": "sensitivity.branch_constrained", "booster-activation": "sensitivity.booster_active", "booster-capacity": "sensitivity.booster_capacity", "operating-point-support": "sensitivity.operating_unsupported", "return-heat-eligibility": "sensitivity.return_unusable" })[type] ?? "sensitivity.invalid";
function sensitivityPrimaryLabel(primary, status) {
  if (status === "INVALID") return translate("sensitivity.invalid");
  if (!primary || primary.type === "none") return translate("analysis.no_active_constraint");
  if (primary.type === "branch-temperature") return primary.branchId + " · " + translate("analysis.branch_temperature");
  if (primary.type === "source-temperature") return translate("analysis.source_temperature");
  if (primary.type === "source-capacity") return translate("analysis.source_capacity");
  if (primary.type === "return-topology") return translate("analysis.return_topology") + " · " + primary.sourceId + " → " + primary.consumerId;
  return "—";
}
function sensitivityEventText(event) {
  if (event.type === "source-eligibility") return translate(event.detail ? "sensitivity.source_usable" : "sensitivity.source_unusable");
  if (event.type === "branch-constraint") return translate(event.detail?.constrained ? "sensitivity.branch_constrained" : "sensitivity.branch_feasible", { branch: event.detail?.branchId ?? "" });
  if (event.type === "booster-activation") return translate(event.detail > 0 ? "sensitivity.booster_active" : "sensitivity.booster_inactive");
  if (event.type === "booster-capacity") return translate(event.detail ? "sensitivity.booster_capacity_sufficient" : "sensitivity.booster_capacity");
  if (event.type === "operating-point-support") return translate(event.detail ? "sensitivity.operating_supported" : "sensitivity.operating_unsupported");
  if (event.type === "return-heat-eligibility") return translate(event.detail?.some(consumer => consumer.eligible) ? "sensitivity.return_usable" : "sensitivity.return_unusable");
  return translate(sensitivityEventKey(event.type));
}
function sensitivitySpec(input = readScenario(), prices = flexPrices()) {
  return createSensitivitySpec($("sensitivity-variable").value, input, prices, $("sensitivity-branch").value || "A", $("sensitivity-stage").value || "stage2");
}
function refreshSensitivityControls(resetRange = false, input = readScenario(), prices = flexPrices()) {
  if (!$("sensitivity-variable").value) $("sensitivity-variable").value = "electricityPrice";
  const variable = $("sensitivity-variable").value, route = input.wasteHeat.mode;
  $("sensitivity-branch-wrap").hidden = variable !== "branchMinimum" && variable !== "branchDemand";
  $("sensitivity-stage-wrap").hidden = variable !== "dcHPCOP" || route !== "two-stage";
  const copOption = [...$("sensitivity-variable").querySelectorAll("option")].find(option => option.value === "dcHPCOP");
  if (copOption) copOption.disabled = route === "raw-return";
  if (variable === "dcHPCOP" && route === "raw-return") {
    $("sensitivity-current-value").textContent = "—";
    $("sensitivity-validation").hidden = false;
    $("sensitivity-validation").textContent = translate("sensitivity.hp_route_required");
    return null;
  }
  const spec = sensitivitySpec(input, prices);
  const label = variable === "dcHPCOP" ? translate($("sensitivity-stage").value === "stage1" ? "sensitivity.stage1" : "sensitivity.stage2") : translate(spec.labelKey);
  $("sensitivity-current-value").textContent = label + " · " + fmt(spec.currentValue, 2) + " " + spec.unit;
  if (resetRange) {
    $("sensitivity-min").value = String(spec.min); $("sensitivity-max").value = String(spec.max); $("sensitivity-step").value = String(spec.step);
  }
  return spec;
}
function sensitivityFingerprint(input, prices) { return JSON.stringify({ input, prices }); }
function setSensitivityStale(reason) {
  sensitivityStaleReason = reason;
  $("sensitivity-stale").hidden = false;
  $("sensitivity-stale").innerHTML = "<span>" + escapeHtml(translate(reason)) + "</span> — <span>" + escapeHtml(translate("sensitivity.rerun")) + "</span>";
}
function sensitivityDelta(value, baseline, info) {
  if (!Number.isFinite(value) || !Number.isFinite(baseline)) return "—";
  const delta = value - baseline, sign = delta > 1e-8 ? "+" : delta < -1e-8 ? "−" : "";
  return translate("sensitivity.delta") + " " + sign + fmt(Math.abs(delta), info.digits) + " " + info.unit;
}
function drawSensitivityChart(result) {
  const svg = $("sensitivity-chart"), info = sensitivityMetricInfo[$("sensitivity-metric").value] ?? sensitivityMetricInfo.operatingCost;
  const points = result.points, values = points.map(point => point.metrics?.[info.key]).filter(Number.isFinite);
  const allY = values.concat([result.baseline.metrics?.[info.key]]).filter(Number.isFinite);
  if (!points.length || !allY.length) { svg.innerHTML = ""; return; }
  const minX = Math.min(...points.map(point => point.value)), maxX = Math.max(...points.map(point => point.value));
  const minY = Math.min(...allY), maxY = Math.max(...allY);
  const sx = value => 54 + ((value - minX) / (maxX - minX || 1)) * 665;
  const sy = value => 210 - ((value - minY) / (maxY - minY || 1)) * 166;
  let segments = [], segment = "";
  points.forEach(point => {
    const value = point.metrics?.[info.key];
    if (point.supported && Number.isFinite(value)) segment += (segment ? " " : "") + sx(point.value) + "," + sy(value);
    else if (segment) { segments.push(segment); segment = ""; }
  });
  if (segment) segments.push(segment);
  const baselineX = sx(result.baseline.value), baselineY = sy(result.baseline.metrics[info.key]);
  let markup = '<line x1="54" y1="210" x2="720" y2="210" class="sensitivity-axis"/><line x1="54" y1="34" x2="54" y2="210" class="sensitivity-axis"/>';
  markup += '<line x1="' + baselineX + '" y1="30" x2="' + baselineX + '" y2="210" class="sensitivity-baseline-line"/><line x1="54" y1="' + baselineY + '" x2="720" y2="' + baselineY + '" class="sensitivity-baseline-line"/>';
  markup += result.thresholds.filter(event => event.value >= minX && event.value <= maxX).map(event => '<line x1="' + sx(event.value) + '" y1="34" x2="' + sx(event.value) + '" y2="210" class="sensitivity-threshold-line"><title>' + escapeHtml(sensitivityEventText(event)) + '</title></line>').join("");
  markup += segments.map(line => '<polyline points="' + line + '" class="sensitivity-line"/>').join("");
  markup += points.map(point => {
    const x = sx(point.value), value = point.metrics?.[info.key], title = fmt(point.value, 2) + " " + result.spec.unit + " · " + translate(sensitivityStatusKey(point.status));
    return point.summary && Number.isFinite(value)
      ? '<circle cx="' + x + '" cy="' + sy(value) + '" r="4" class="' + (point.supported ? "sensitivity-point" : "sensitivity-point unsupported") + '"><title>' + escapeHtml(title) + '</title></circle>'
      : '<path d="M ' + (x-4) + ' 228 l 8 8 m 0 -8 l -8 8" class="sensitivity-invalid-point"><title>' + escapeHtml(title) + '</title></path>';
  }).join("");
  markup += '<circle cx="' + baselineX + '" cy="' + baselineY + '" r="6" class="sensitivity-baseline-point"/>';
  markup += '<text x="54" y="239" class="sensitivity-axis-label">' + fmt(minX, 2) + " " + escapeHtml(result.spec.unit) + '</text><text x="720" y="239" text-anchor="end" class="sensitivity-axis-label">' + fmt(maxX, 2) + " " + escapeHtml(result.spec.unit) + '</text>';
  markup += '<text x="5" y="44" class="sensitivity-axis-label">' + fmt(maxY, info.digits) + '</text><text x="5" y="210" class="sensitivity-axis-label">' + fmt(minY, info.digits) + '</text>';
  markup += '<text x="58" y="22" class="sensitivity-axis-label">' + escapeHtml(translate(info.label)) + " · " + escapeHtml(info.unit) + '</text><text x="' + Math.min(650, baselineX + 5) + '" y="45" class="sensitivity-baseline-label">' + escapeHtml(translate("sensitivity.baseline")) + '</text>';
  svg.innerHTML = markup;
}
function renderSensitivityResult() {
  const result = sensitivityResult;
  if (!result) return;
  const summary = summarizeSensitivitySweep(result), info = sensitivityMetricInfo[$("sensitivity-metric").value] ?? sensitivityMetricInfo.operatingCost;
  const baselineValue = result.baseline.metrics[info.key];
  $("sensitivity-baseline-value").textContent = fmt(baselineValue, info.digits) + " " + info.unit;
  const lowest = summary.lowest ? fmt(summary.lowest.metrics.operatingCost, 2) + " €/h · " + fmt(summary.lowest.value, 2) + " " + result.spec.unit : "—";
  const highest = summary.highest ? fmt(summary.highest.metrics.operatingCost, 2) + " €/h · " + fmt(summary.highest.value, 2) + " " + result.spec.unit : "—";
  const range = summary.supportedRange ? fmt(summary.supportedRange[0], 2) + "–" + fmt(summary.supportedRange[1], 2) + " " + result.spec.unit : "—";
  const limit = summary.firstTechnicalLimit ? sensitivityEventText(summary.firstTechnicalLimit) + " · " + fmt(summary.firstTechnicalLimit.value, 2) + " " + result.spec.unit : translate("sensitivity.no_limit");
  $("sensitivity-summary").innerHTML = "<b>" + escapeHtml(translate("sensitivity.summary")) + "</b><div><span>" + escapeHtml(translate("sensitivity.baseline")) + "</span><strong>" + fmt(result.baseline.metrics.operatingCost, 2) + " €/h</strong></div><div><span>" + escapeHtml(translate("sensitivity.lowest")) + "</span><strong>" + escapeHtml(lowest) + "</strong></div><div><span>" + escapeHtml(translate("sensitivity.highest")) + "</span><strong>" + escapeHtml(highest) + "</strong></div><div><span>" + escapeHtml(translate("sensitivity.supported_range")) + "</span><strong>" + escapeHtml(range) + "</strong></div><div><span>" + escapeHtml(translate("sensitivity.first_limit")) + "</span><strong>" + escapeHtml(limit) + "</strong></div>";
  drawSensitivityChart(result);
  $("sensitivity-thresholds").innerHTML = result.thresholds.length
    ? "<b>" + escapeHtml(translate("sensitivity.first_limit")) + "</b><ul>" + result.thresholds.map(event => "<li>" + escapeHtml(sensitivityEventText(event)) + " · " + fmt(event.value, 2) + " " + escapeHtml(result.spec.unit) + "</li>").join("") + "</ul>"
    : "<p>" + escapeHtml(translate("sensitivity.no_limit_in_range")) + "</p>";
  const local = summary.local;
  $("sensitivity-local").innerHTML = local
    ? "<b>" + escapeHtml(translate("sensitivity.local")) + "</b><div>" + escapeHtml(translate("sensitivity.lower_side")) + ": " + fmt(local.lower.value, 2) + " " + escapeHtml(result.spec.unit) + " · " + sensitivityDelta(local.lower.metrics[info.key], baselineValue, info) + "</div><div>" + escapeHtml(translate("sensitivity.upper_side")) + ": " + fmt(local.upper.value, 2) + " " + escapeHtml(result.spec.unit) + " · " + sensitivityDelta(local.upper.metrics[info.key], baselineValue, info) + "</div>" + (local.asymmetric ? "<strong>" + escapeHtml(translate("sensitivity.nonlinear")) + "</strong>" : "")
    : "<b>" + escapeHtml(translate("sensitivity.local")) + "</b><span>—</span>";
  const metricOrder = ["operatingCost", "usableHeat", "centralProduction", "totalElectricity", "boosterElectricity", "constrainedBranches"];
  const units = ["€/h", "kWth", "kWth", "kWe", "kWe", ""], digits = [2, 0, 0, 0, 0, 0];
  $("sensitivity-table-head").innerHTML = "<tr><th>" + escapeHtml(translate("sensitivity.variable")) + "</th><th>" + escapeHtml(translate("sensitivity.status")) + "</th>" + ["sensitivity.metric.operating_cost", "sensitivity.metric.usable_heat", "sensitivity.metric.central_production", "sensitivity.metric.total_electricity", "sensitivity.metric.booster_electricity", "sensitivity.metric.constrained_branches", "analysis.primary_constraint_short"].map(key => "<th>" + escapeHtml(translate(key)) + "</th>").join("") + "</tr>";
  $("sensitivity-table-body").innerHTML = result.points.map(point => {
    const m = point.metrics ?? {};
    const cells = metricOrder.map((key, index) => {
      const value = m[key], baseline = result.baseline.metrics[key];
      return "<td>" + (Number.isFinite(value) ? fmt(value, digits[index]) + (units[index] ? " " + units[index] : "") + "<small>" + escapeHtml(sensitivityDelta(value, baseline, { digits: digits[index], unit: units[index] })) + "</small>" : "—") + "</td>";
    }).join("");
    return "<tr><td>" + fmt(point.value, 2) + " " + escapeHtml(result.spec.unit) + "</td><td>" + escapeHtml(translate(sensitivityStatusKey(point.status))) + "</td>" + cells + "<td>" + escapeHtml(sensitivityPrimaryLabel(point.primary, point.status)) + "</td></tr>";
  }).join("");
  $("sensitivity-key-rows").innerHTML = sensitivityKeyResults.map(item => {
    const detail = item.sides.map(side => {
      const sideLabel = translate(side.value < item.currentValue ? "sensitivity.lower_side" : "sensitivity.upper_side");
      const effect = Number.isFinite(side.costDelta)
        ? side.costDelta > 1e-8 ? escapeHtml(translate("sensitivity.cost_increase")) + " +€" + fmt(side.costDelta, 2) + "/h"
          : side.costDelta < -1e-8 ? escapeHtml(translate("sensitivity.cost_saving")) + " €" + fmt(Math.abs(side.costDelta), 2) + "/h"
            : escapeHtml(translate("sensitivity.no_cost_change"))
        : escapeHtml(translate(sensitivityStatusKey(side.status)));
      return sideLabel + ": " + effect;
    }).join(" · ");
    return "<div><span>" + escapeHtml(translate(item.labelKey)) + (item.nonlinear ? "<small>" + escapeHtml(detail) + "</small>" : "") + "</span><b>" + (item.nonlinear ? escapeHtml(translate("sensitivity.nonlinear")) : "±" + fmt(item.impact, 2) + " €/h") + "</b></div>";
  }).join("");
}
function runSensitivityAnalysis() {
  const warning = $("sensitivity-validation");
  try {
    const input = readScenario(), prices = flexPrices(), spec = refreshSensitivityControls(false, input, prices);
    if (!spec) return;
    const values = buildSensitivityValues($("sensitivity-min").value, $("sensitivity-max").value, $("sensitivity-step").value, 100);
    sensitivityResult = calculateSensitivitySweep(input, prices, spec, values);
    sensitivityKeyResults = calculateKeySensitivities(input, prices, (variable, source, costs) => createSensitivitySpec(variable, source, costs));
    sensitivityBaselineSignature = sensitivityFingerprint(input, prices);
    sensitivityStaleReason = ""; $("sensitivity-stale").hidden = true; warning.hidden = true; warning.textContent = "";
    renderSensitivityResult();
  } catch (error) {
    const message = String(error?.message ?? "");
    const key = message.includes("point limit") ? "sensitivity.validation.point_limit"
      : message.includes("finite values") ? "sensitivity.validation.range"
        : message.includes("supported sensitivity variable") ? "sensitivity.validation.variable"
          : message.includes("Choose branch") ? "sensitivity.validation.branch" : "sensitivity.validation.failed";
    warning.hidden = false; warning.textContent = translate(key, { limit: 100 });
  }
}
function resetSensitivityRange() { refreshSensitivityControls(true); $("sensitivity-validation").hidden = true; sensitivitySettingsChanged(); }
function sensitivitySettingsChanged() { if (sensitivityResult) setSensitivityStale("sensitivity.settings_changed"); }

function renderFlex(input, liveResult) {
  const validation = $("sweep-validation");
  try {
    const prices = flexPrices();
    if (Object.values(prices).some(value => !Number.isFinite(value) || value < 0)) throw new Error("Operating-cost inputs must be non-negative numbers.");
    const targets = sweepTargets();
    const points = calculateTemperatureFlexSweep(input, targets, prices);
    const selected = summarizeNetworkFlexState(liveResult, input, prices);
    validation.hidden = true; validation.textContent = "";
    renderScenarioSnapshots();
    renderMarginalTemperature(input, points, prices, input.hmpTargetTemp);
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
    refreshSensitivityControls(false, input, prices);
    if (sensitivityResult) renderSensitivityResult();
  } catch (error) { validation.hidden = false; validation.textContent = error.message; }
}

function renderReturnHeat(result) {
  const state = result.returnNetwork;
  const consumerNodes = state.nodes.filter(node => node.type === "THREE_PIPE_CONSUMER");
  $("return-heat-balance").innerHTML = [
    ["DEMAND", state.totalDemandKW], ["AVAILABLE ELIGIBLE", state.eligibleAvailableKW],
    ["RETURN HEAT", state.allocatedKW], ["SUPPLY TOP-UP", state.unservedKW], ["UNUSED SOURCE HEAT", state.unusedSourceKW]
  ].map(([label, kw]) => `<article><span>${label}</span><b>${fmt(kw / 1000, 2)} MW</b></article>`).join("")
    ;
  set("return-temp-before", `${fmt(state.returnTempBeforeRecoveryC)} °C`);
  set("return-temp-plant", `${fmt(state.returnTempAtPlantC)} °C`);
  set("return-cooling-benefit", `${fmt(state.coolingBenefitK)} K`);
  $("return-pipe").innerHTML = state.nodes.map(node => {
    if (node.type === "CENTRAL_PLANT") return `<div class="return-node plant-return-node"><span>♨</span><b>CENTRAL PLANT</b><strong>${fmt(node.inletTempC)} °C</strong><small>RETURN RECEIVED</small></div>`;
    const source = node.type === "WASTE_HEAT_SOURCE";
    const consumer = node.type === "THREE_PIPE_CONSUMER";
    const status = source ? node.enabled === false ? "DISABLED" : node.dispatchedKW > 0 ? "INJECTING" : "UNUSED SOURCE HEAT"
      : consumer ? node.allocatedKW >= node.demandKW && node.demandKW > 0 ? "RETURN HEAT ONLY"
        : node.allocatedKW > 0 ? "RETURN + SUPPLY TOP-UP" : "SUPPLY TOP-UP ONLY" : "ORDINARY RETURN FLOW";
    const power = source ? `+${fmt(node.dispatchedKW ?? 0)} kW INJECTION` : consumer ? `RETURN HEAT ${fmt(node.allocatedKW ?? 0)} kW` : "";
    const temperatureLine = source ? `SOURCE ${fmt(node.sourceTempC)} °C · ${fmt((node.availableKW ?? 0) / 1000, 2)} MW AVAILABLE`
      : consumer ? `DEMAND ${fmt(node.demandKW)} kW · MIN ${fmt(node.minimumUsableTempC)} °C` : "ORDINARY RETURN FLOW";
    let eligibility = "";
    if (consumer) {
      const downstream = state.sources.filter(candidate => Number(candidate.order) >= Number(node.order));
      const upstream = state.sources.filter(candidate => isReturnSourceAvailableToConsumer(candidate, node));
      if (!upstream.length && downstream.length) eligibility = "SOURCE DOWNSTREAM — NOT AVAILABLE";
      else if (upstream.length && !upstream.some(candidate => Number(candidate.sourceTempC) >= Number(node.minimumUsableTempC))) eligibility = "UPSTREAM SOURCE TEMPERATURE TOO LOW";
      else if (!upstream.length) eligibility = "NO UPSTREAM SOURCE";
    }
    const showWhy = document.body.dataset.mode === "demo" && (source || consumer);
    return `<div class="return-node ${source ? "injection-node" : consumer ? "extraction-node" : "ordinary-return-node"}" ${source || consumer ? `data-return-object="${source ? node.id === "SM-1" ? "supermarket" : "source" : "pip3"}" data-node-id="${node.id}" tabindex="0" role="button"` : ""}><span class="return-node-icon">${source ? "＋" : consumer ? "−" : "↙"}</span><b>${escapeHtml(node.name).toUpperCase()}</b><strong>${fmt(node.inletTempC)} °C <i>→</i> ${fmt(node.outletTempC)} °C</strong><small>${temperatureLine}</small><small>${power}</small><em>${status}</em>${eligibility ? `<small class="topology-warning">${eligibility}</small>` : ""}<small class="engineer-only">ORDER ${fmt(node.order, 0)} · FLOW ${fmt(node.returnFlowM3h ?? state.returnFlowM3h, 0)} m³/h</small>${showWhy ? `<button type="button" class="network-why-button" data-inspect-kind="${source ? node.id === "SM-1" ? "supermarket" : "source" : "pip3"}" data-i18n="interaction.why">WHY?</button>` : ""}</div>`;
  }).join(`<span class="return-flow-arrow" aria-hidden="true">→</span>`);
  for (const node of $("return-pipe").querySelectorAll("[data-return-object]")) {
    const selected = node.dataset.returnObject === "pip3" && node.dataset.nodeId === selectedPip3Branch;
    node.setAttribute("aria-pressed", String(selected));
    node.classList.toggle("selected", selected);
  }
  $("return-source-balance").innerHTML = state.sources.map(source => `<article><b>${escapeHtml(source.name)}</b><span>Available ${fmt(source.availableKW / 1000, 2)} MW · dispatched ${fmt(source.dispatchedKW / 1000, 2)} MW · remaining ${fmt(source.remainingKW / 1000, 2)} MW</span></article>`).join("") || "No active return-side sources.";
  $("return-consumer-balance").innerHTML = consumerNodes.map(consumer => {
    const split = calculatePip3HeatSplit(consumer.demandKW, consumer.allocatedKW);
    const status = split.demandKW > 0 && split.returnHeatKW >= split.demandKW ? "RETURN HEAT ONLY"
      : split.returnHeatKW > 0 ? "RETURN + SUPPLY TOP-UP" : "SUPPLY TOP-UP ONLY";
    return `<article><b>${escapeHtml(consumer.name)} <i>${status}</i></b><span>DEMAND ${fmt(split.demandKW / 1000, 2)} MW · RETURN HEAT ${fmt(split.returnHeatKW / 1000, 2)} MW · SUPPLY TOP-UP ${fmt(split.supplyTopUpKW / 1000, 2)} MW</span><small>RETURN IN ${fmt(consumer.inletTempC)} °C · RETURN OUT ${fmt(consumer.outletTempC)} °C · ΔT ${fmt(consumer.outletTempC - consumer.inletTempC)} K</small></article>`;
  }).join("") || "No active PIP3 branch demand.";
}

function renderFullSystem(result, input) {
  const after = result.withBooster;
  const state = result.returnNetwork;
  const consumers = new Map(state.nodes.filter(node => node.type === "THREE_PIPE_CONSUMER").map(consumer => [consumer.id, consumer]));
  const supermarket = state.sources.find(item => item.id === "SM-1");
  const dataCenterReturn = state.sources.find(item => item.id === "DC-RETURN");
  const plantActive = after.centralPlantUsedKW > 0 && after.centralPlant.temperatureEligible;
  const dcActive = after.wasteHeat.injectedKW > 0 || after.wasteHeat.usedViaBlending === true;
  const dcReturnActive = (dataCenterReturn?.dispatchedKW ?? 0) > 0;
  const hmpActive = after.networkOperatingPointSupported;

  $("full-plant-return").textContent = `${fmt(state.returnTempAtPlantC)} °C`;
  $("full-plant-supply").textContent = `${fmt(after.centralPlant.supplyTemp)} °C`;
  $("full-hmp-target").textContent = `TARGET ${fmt(after.hmpTargetTemp)} °C`;
  $("full-hmp-capability").textContent = `CAPABILITY ${fmt(after.hmpTemperatureCapabilityTemp)} °C`;
  const rawReturnMode = after.wasteHeat.mode === "raw-return";
  $("full-dc-temp").textContent = `${fmt(Number(input.wasteHeat.injectionTemp))} °C RAW SOURCE`;
  $("full-dc-outlet").textContent = rawReturnMode ? "→ RETURN NETWORK" : `→ ${fmt(after.wasteHeat.outletTemp)} °C ${after.wasteHeat.mode === "one-stage" ? "ONE-STAGE OUT" : "TWO-STAGE OUT"}`;
  $("full-dc-at-hmp").textContent = rawReturnMode ? "" : `→ ${fmt(after.wasteHeat.contributionTemp)} °C AT HMP`;
  $("full-dc-at-hmp").hidden = rawReturnMode;
  $("full-dc-mode").textContent = rawReturnMode ? "RAW RETURN" : `${after.wasteHeat.mode === "one-stage" ? "ONE-STAGE" : "TWO-STAGE"} SUPPLY`;
  $("full-dc-status").textContent = after.wasteHeat.mode === "raw-return" ? "RETURN ONLY" : "SUPPLY/HMP ONLY";
  $("full-dc-allocation").textContent = rawReturnMode ? "RAW WASTE HEAT → RETURN" : "UPGRADED HEAT → SUPPLY/HMP";
  $("full-dc-return-label").textContent = after.wasteHeat.mode === "raw-return" ? `RAW RETURN · +${fmt((dataCenterReturn?.dispatchedKW ?? 0) / 1000, 2)} MW` : "RAW RETURN · INACTIVE";
  $("full-sm-temp").textContent = `${fmt(Number(supermarket?.sourceTempC))} °C`;
  $("full-sm-power").textContent = `+${fmt((supermarket?.dispatchedKW ?? 0) / 1000, 2)} MW`;
  $("full-sm-status").textContent = supermarket?.dispatchedKW > 0 ? "RETURN ONLY" : supermarket?.enabled === false ? "OFF" : "IDLE";
  $("full-return-to-plant").textContent = `${fmt(state.returnTempAtPlantC)} °C`;
  $("full-supply-main-temp").textContent = `${fmt(after.hmpTemperatureCapabilityTemp)} °C`;
  $("full-return-main-label").textContent = `RETURN MAIN · ${fmt(state.returnTempBeforeRecoveryC)} °C BEFORE RECOVERY`;
  $("full-return-temperature-layer").textContent = `RETURN TO PLANT · ${fmt(state.returnTempAtPlantC)} °C`;
  $("full-plant-node").classList.toggle("plant-inactive", !plantActive);
  $("full-dc-node").classList.toggle("source-inactive", !dcActive && after.wasteHeat.mode !== "raw-return");
  $("full-dc-pipe").classList.toggle("pipe-inactive", !dcActive);
  $("full-dc-return-pipe").classList.toggle("pipe-inactive", after.wasteHeat.mode !== "raw-return");
  $("full-dc-return-label").classList.toggle("source-inactive", !dcReturnActive);
  $("full-sm-node").classList.toggle("source-inactive", !supermarket || supermarket.dispatchedKW <= 0);
  $("full-sm-pipe").classList.toggle("pipe-inactive", !supermarket || supermarket.dispatchedKW <= 0);
  $("full-hmp-node").classList.toggle("hmp-deficit", !hmpActive);

  $("full-branch-layer").innerHTML = after.afterBranches.map(branch => {
    const pip3Customer = ["D", "E", "F"].includes(branch.id);
    const consumer = pip3Customer ? consumers.get(branch.id) : null;
    const heatSplit = calculatePip3HeatSplit(branch.demandKW, consumer?.allocatedKW ?? 0);
    const returnHeatActive = pip3Customer && heatSplit.returnHeatKW > 0;
    const shortName = branch.name.replace("Campus high-temp", "Campus HT");
    const boosters = branch.gridBoosters
      .map(item => `<span class="full-booster-chip${item.actualLiftK > 0 ? " active" : " idle"}" aria-label="${escapeHtml(item.id)} Gridbooster${item.actualLiftK > 0 ? `, lift ${fmt(item.actualLiftK)} K` : `, ${translate(branch.feasibleWithoutBooster ? "interaction.no_lift_required" : "interaction.no_lift_applied")}`}">⚡ ${escapeHtml(item.id)} · ${item.actualLiftK > 0 ? `+${fmt(item.actualLiftK)} K` : escapeHtml(translate(branch.feasibleWithoutBooster ? "interaction.no_lift_required" : "interaction.no_lift_applied"))}</span>`).join("");
    const status = branch.boosterActive ? "BOOSTED" : branch.status === "below" ? "NEEDS LIFT" : branch.status === "close" ? "CLOSE" : "TEMP OK";
    const pip3Split = pip3Customer ? `<div class="full-pip3-split" aria-label="PIP3 heat split for branch ${branch.id}"><b>PIP3</b><span>TOTAL DEMAND ${fmt(heatSplit.demandKW / 1000, 2)} MW</span><span>RETURN HEAT ${fmt(heatSplit.returnHeatKW / 1000, 2)} MW</span><span>SUPPLY TOP-UP ${fmt(heatSplit.supplyTopUpKW / 1000, 2)} MW</span><small>RETURN IN ${fmt(consumer?.inletTempC)} °C</small></div>` : "";
    return `<article class="full-customer-column${pip3Customer ? " pip3-customer-column" : ""}${returnHeatActive ? " return-heat-intake" : ""}" data-branch="${branch.id}">
      <div class="full-branch-drop full-supply-drop" aria-hidden="true"></div>${boosters}
      <div class="branch-route-card full-branch-card"><div class="branch-route-head"><b class="branch-flag">${branch.id}</b><strong>${escapeHtml(shortName).toUpperCase()}</strong><span class="branch-status">${status}</span>${pip3Customer && document.body.dataset.mode === "demo" ? `<button type="button" class="network-why-button" data-inspect-kind="pip3" data-i18n="interaction.why">WHY?</button>` : ""}</div><div class="branch-route-values"><b class="branch-temp">${fmt(branch.finalSupplyTemp)} °C SUPPLY</b><span>MIN ${fmt(branch.minimumSupplyTemp)} °C</span><span>LOAD ${fmt(branch.demandKW / 1000, 2)} MW</span></div>${pip3Split}</div>
      <div class="full-branch-drop full-return-drop" aria-hidden="true"></div>
    </article>`;
  }).join("");
  for (const customer of $("full-branch-layer").querySelectorAll(".full-customer-column")) {
    customer.tabIndex = 0; customer.setAttribute("role", "button");
    customer.setAttribute("aria-pressed", String(customer.dataset.branch === selectedNetworkBranch));
    customer.classList.toggle("selected", customer.dataset.branch === selectedNetworkBranch);
  }
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
  $("demo-hmp-control").value = String(after.hmpTargetTemp);
  $("demo-hmp-value").textContent = `${fmt(after.hmpTargetTemp)} °C`;
  $("network-dc-route").value = source.mode;
  $("hmp-slider-value").textContent = fmt(after.hmpTargetTemp);
  set("outdoor-context", `OUTDOOR ${fmt(after.outdoorTemp)} °C · CONTEXT`);
  set("map-production-temp", `${fmt(plant.supplyTemp)} °C SOURCE`);
  set("map-plant-contribution", `${fmt(plant.contributionTemp)} °C AT HMP`);
  set("map-production-power", `${fmt(plant.availableKW)} kWth avail. · ${fmt(after.centralPlantUsedKW)} kWth used`);
  set("map-plant-availability", `${fmt(Number($("plant-availability").value), 0)}% AVAILABLE`);
  set("map-plant-loss", `−${fmt(plant.lossToHMP)} K LOSS`);
  set("map-plant-status", plant.temperatureEligible ? "✓ TEMP SUPPORTS TARGET" : "! TOO COOL FOR TARGET");
  $("map-plant-status").className = `mini-status ${plant.temperatureEligible ? "eligible" : "ineligible"}`;
  set("map-hmp-temp", `${fmt(after.hmpTemperatureCapabilityTemp)} °C ${after.sourceBlending?.selected ? "BLENDED ESTIMATE" : "CAPABILITY"}`);
  set("map-hmp-method-note", after.sourceBlending?.selected ? "SIMPLIFIED MIXING ESTIMATE · NOT HYDRAULIC" : "TEMPERATURE CAPABILITY · NOT A MIXED HMP RESULT");
  set("map-hmp-target", `TARGET ${fmt(after.hmpTargetTemp)} °C`);
  const temperatureReachable = after.hmpTemperatureReachable;
  const capacityShortfall = after.hmpPowerShortfallKW > 1e-9;
  const operatingPointSupported = after.networkOperatingPointSupported;
  const capacityWarning = $("hmp-capacity-warning");
  if (temperatureReachable && capacityShortfall) {
    capacityWarning.hidden = false;
    capacityWarning.textContent = `HMP target temperature is thermally reachable, but available source capacity is insufficient by ${fmt(after.hmpPowerShortfallKW)} kW.`;
  } else if (!temperatureReachable && after.hmpTemperatureCapabilityTemp != null) {
    capacityWarning.hidden = false;
    capacityWarning.textContent = `HMP target temperature is not thermally reachable. Available temperature capability is ${fmt(after.hmpTemperatureCapabilityTemp)} °C after source-path losses${capacityShortfall ? `, with source capacity also insufficient by ${fmt(after.hmpPowerShortfallKW)} kW` : ""}.`;
  } else if (after.hmpTemperatureCapabilityTemp == null) {
    capacityWarning.hidden = false;
    capacityWarning.textContent = "HMP temperature capability is unavailable: no active heat source has available power.";
  } else {
    capacityWarning.hidden = true;
    capacityWarning.textContent = "";
  }
  set("map-hmp-status", !temperatureReachable ? after.hmpTemperatureCapabilityTemp == null ? "⛔ NO SOURCE TEMPERATURE" : `! TEMP DEFICIT ${fmt(after.hmpTargetTemp - after.hmpTemperatureCapabilityTemp)} K` : capacityShortfall ? `⚠ TEMP REACHABLE · ${fmt(after.hmpPowerShortfallKW)} kW CAPACITY SHORT` : "✓ TEMP & CAPACITY SUFFICIENT");
  $("map-hmp-status").className = `mini-status ${operatingPointSupported ? "eligible" : "ineligible"}`;
  set("map-main-temp", `${fmt(after.hmpTemperatureCapabilityTemp)} °C ${after.sourceBlending?.selected ? "SIMPLIFIED MIXING ESTIMATE" : "CAPABILITY"} · TARGET ${fmt(after.hmpTargetTemp)} °C`);
  set("map-dc-temp", `${fmt(Number(input.wasteHeat.injectionTemp))} °C RAW SOURCE`);
  set("map-dc-outlet", source.mode === "raw-return" ? "→ RETURN NETWORK" : `→ ${fmt(source.outletTemp)} °C ${source.mode === "one-stage" ? "ONE-STAGE OUT" : "TWO-STAGE OUT"}`);
  set("map-dc-contribution", source.mode === "raw-return" ? "0 kWth TO HMP · RAW RETURN ONLY" : `→ ${fmt(source.contributionTemp)} °C AT HMP`);
  set("map-dc-power", `${fmt(source.sourceHeatKW)} kWth raw source · ${fmt(source.injectedKW)} kWth to HMP`);
  set("map-dc-availability", `${fmt(Number($("dc-availability").value), 0)}% AVAILABLE`);
  const usedViaBlending = source.usedViaBlending === true;
  const strictEligible = source.strictTemperatureEligible ?? source.injectionEligible;
  set("map-dc-loss", source.mode === "raw-return" ? "SUPPLY ROUTE INACTIVE · RAW HEAT GOES TO RETURN" : `−${fmt(source.lossToHMP)} K LOSS · ${usedViaBlending ? "USED VIA BLENDING ▶" : strictEligible ? "STRICTLY ELIGIBLE ▶" : "STRICTLY BLOCKED"}`);
  set("map-dc-status", source.mode === "raw-return" ? "RAW RETURN ONLY · NO HMP INJECTION" : usedViaBlending ? `STRICTLY BLOCKED · USED VIA BLENDED SOURCE OPERATION · ${fmt(source.injectedKW)} kWth` : !strictEligible ? "⛔ CANNOT INJECT · T ≤ HMP TARGET" : source.injectedKW > 0 ? `▶ ${source.mode.toUpperCase()} · INJECTING` : "✓ TEMP ELIGIBLE · NO HEAT INJECTED");
  $("map-dc-status").className = `mini-status ${strictEligible || usedViaBlending ? "eligible" : "ineligible"}`;
  $("plant-feed-pipe").classList.toggle("pipe-blocked", !plant.temperatureEligible || after.centralPlantUsedKW <= 0);
  $("dc-feed-pipe").classList.toggle("pipe-blocked", source.mode === "raw-return" || !(strictEligible || usedViaBlending) || source.injectedKW <= 0);
  $("hmp-node").classList.toggle("hmp-deficit", !temperatureReachable);
  $("hmp-node").classList.toggle("hmp-capacity-limited", temperatureReachable && capacityShortfall);
  renderBranches(after);
  renderReturnHeat(result);
  renderFullSystem(result, input);
  updateNetworkView();
  renderBoosterTray();
  renderSystemSummary(result, input);
  renderProfile(after); renderBranchComparison(after); renderEnergy(after); renderDataCenterModes(result); renderComparison(result, result.comparison);
  if (document.body.dataset.mode === "demo") renderGuidedDemo(input, latestNetworkState);
}

function recalculate() {
  const warning = $("network-validation");
  try {
    const input = readScenario(), prices = flexPrices(), result = simulateNetwork(input, prices);
    if (sensitivityResult && sensitivityBaselineSignature) {
      const baselineMatches = sensitivityBaselineSignature === sensitivityFingerprint(input, prices);
      if (!baselineMatches) setSensitivityStale("sensitivity.baseline_changed");
      else if (sensitivityStaleReason === "sensitivity.baseline_changed") {
        sensitivityStaleReason = ""; $("sensitivity-stale").hidden = true;
      }
    }
    latestNetworkState = result;
    if (guidedDemoStep === 1) {
      const bottleneck = findPrimaryTemperatureBottleneck(result.withBooster.afterBranches);
      if (!bottleneck) { bottleneckFound = false; $("demo-branch-feedback").textContent = translate("interaction.no_constraint"); }
      else if (selectedNetworkBranch !== bottleneck.id) bottleneckFound = false;
    }
    const comparisonView = document.body.dataset.mode === "demo" && demoComparisonBaseline
      ? simulateNetwork(guidedDemoInputs(input, 90, []), prices) : result;
    warning.hidden = true; warning.textContent = ""; render(comparisonView, input); renderOpportunitySummary(input, result, prices); renderFlex(input, result);
  }
  catch (error) { warning.hidden = false; warning.textContent = `Check network inputs: ${error.message}`; }
}

function loadScenario(index) {
  const scenario = scenarios[index];
  const pip3Orders = scenario.pip3Orders ?? { D: 20, E: 30, F: 40 };
  const returnDefaults = { "return-base-temp": scenario.networkReturnTemp ?? 45, "return-flow": scenario.returnFlowM3h ?? 50,
    "sm-enabled": scenario.supermarketEnabled ? "true" : "false", "sm-temp": scenario.supermarketSourceTempC ?? 48,
    "sm-power": scenario.supermarketPowerKW ?? 350, "sm-max-injection": scenario.supermarketPowerKW ?? 350,
    "pip3-d-min-temp": 45, "pip3-d-max-uptake": 1500, "pip3-e-min-temp": 45, "pip3-e-max-uptake": 1900,
    "pip3-f-min-temp": 45, "pip3-f-max-uptake": 1300,
    "dc-return-order": 10, "sm-order": 15, "pip3-d-order": pip3Orders.D, "pip3-e-order": pip3Orders.E, "pip3-f-order": pip3Orders.F };
  for (const [id, value] of Object.entries(returnDefaults)) $(id).value = value;
  $("network-view-selector").value = scenario.returnHeatDemo ? scenario.multiLevelWasteHeatDemo ? "full" : "return" : "supply";
  $("network-return-temp").value = scenario.networkReturnTemp ?? 40;
  $("network-reference-delta").value = scenario.referenceNetworkDeltaK ?? "";
  $("source-temperature-strategy").value = "strict";
  $("normal-plant-supply").value = scenario.plantTemp;
  $("max-ramped-plant-supply").value = Number(scenario.plantTemp) + 15;
  for (const [id, key] of [["hmp-target", "hmp"], ["outdoor-temp", "outdoor"], ["plant-temp", "plantTemp"], ["plant-power", "plantPower"], ["plant-availability", "plantAvailability"], ["plant-loss", "plantLoss"], ["dc-mode", "dcMode"], ["dc-temp", "dcTemp"], ["dc-power", "dcPower"], ["dc-availability", "dcAvailability"], ["dc-loss", "dcLoss"], ["booster-branch", "branch"], ["booster-mode", "mode"], ["booster-setpoint", "setpoint"], ["network-cop", "cop"], ["booster-capacity", "capacity"], ["dc-single-temp", "singleTemp"], ["dc-single-cop", "singleCOP"], ["dc-stage1-temp", "stage1Temp"], ["dc-stage1-cop", "stage1COP"], ["dc-stage2-temp", "stage2Temp"], ["dc-stage2-cop", "stage2COP"]]) $(id).value = scenario[key];
  $("dc-return-max-injection").value = scenario.dcMode === "raw-return" ? scenario.dcPower * 1000 : 0;
  for (const item of branchControls.querySelectorAll("input")) { const branch = branchDefaults.find(b => b.id === item.dataset.branch); if (branch) item.value = item.dataset.key === "name" ? branchName(branch) : branch[item.dataset.key] ?? ""; }
  gridBoosters = scenario.gridBoosters.map(item => ({ ...item }));
  nextBoosterId = Math.max(1, ...gridBoosters.map(item => {
    const match = String(item.id).match(/^GB-(\d+)$/);
    return match ? Number(match[1]) + 1 : 1;
  }));
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
$("dc-mode").addEventListener("input", () => {
  if ($("dc-mode").value === "raw-return" && Number($("dc-return-max-injection").value) === 0)
    $("dc-return-max-injection").value = Number($("dc-power").value) * 1000 * Number($("dc-availability").value) / 100;
});
$("network-dc-route").addEventListener("change", () => {
  $("dc-mode").value = $("network-dc-route").value;
  if ($("dc-mode").value === "raw-return" && Number($("dc-return-max-injection").value) === 0)
    $("dc-return-max-injection").value = Number($("dc-power").value) * 1000 * Number($("dc-availability").value) / 100;
  recalculate();
});
$("demo-hmp-control").addEventListener("input", () => { $("hmp-target").value = $("demo-hmp-control").value; $("hmp-target-slider").value = $("demo-hmp-control").value; recalculate(); });
$("demo-comparison-toggle").addEventListener("click", () => { demoComparisonBaseline = !demoComparisonBaseline; recalculate(); });
$("network-inspector-close").addEventListener("click", () => closeNetworkInspector());
document.addEventListener?.("keydown", event => { if (event.key === "Escape" && !$("network-inspector").hidden) $("network-inspector-close").click(); });
$("network-map").addEventListener("click", event => {
  const inspect = event.target.closest?.("[data-inspect-kind]");
  if (inspect && !inspect.hidden) {
    if (document.body.dataset.mode !== "demo") return;
    if (inspect.dataset.inspectKind === "booster") selectedNetworkBranch = inspect.closest(".network-branch-row")?.dataset.branch ?? selectedNetworkBranch;
    if (inspect.dataset.inspectKind === "pip3") {
      selectedPip3Branch = inspect.closest("[data-branch]")?.dataset.branch ?? selectedPip3Branch;
      const returnNode = inspect.closest("[data-return-object]");
      if (returnNode) selectedPip3Branch = returnNode.dataset.nodeId;
      if (selectedPip3Branch) selectedNetworkBranch = selectedPip3Branch;
      recalculate();
    }
    inspectObject(inspect.dataset.inspectKind); return;
  }
  const customer = event.target.closest?.(".full-customer-column[data-branch]");
  if (customer && !event.target.closest("button")) {
    selectedPip3Branch = customer.dataset.branch;
    selectedNetworkBranch = customer.dataset.branch;
    recalculate();
  }
  const returnObject = event.target.closest?.("[data-return-object]");
  if (returnObject && !event.target.closest("button")) {
    if (returnObject.dataset.returnObject === "pip3") { selectedPip3Branch = returnObject.dataset.nodeId; selectedNetworkBranch = selectedPip3Branch; recalculate(); }
    if (document.body.dataset.mode === "demo") inspectObject(returnObject.dataset.returnObject);
  }
});
$("network-map").addEventListener("keydown", event => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const customer = event.target.closest?.(".full-customer-column[data-branch]");
  const returnObject = event.target.closest?.("[data-return-object]");
  if (customer) { event.preventDefault(); selectedPip3Branch = customer.dataset.branch; selectedNetworkBranch = customer.dataset.branch; recalculate(); }
  if (returnObject) { event.preventDefault(); if (returnObject.dataset.returnObject === "pip3") selectedPip3Branch = returnObject.dataset.nodeId; if (document.body.dataset.mode === "demo") inspectObject(returnObject.dataset.returnObject); }
});
$("sm-move-upstream").addEventListener("click", () => { $("sm-order").value = String(Math.max(0, Number($("sm-order").value) - 10)); recalculate(); });
$("sm-move-downstream").addEventListener("click", () => { $("sm-order").value = String(Math.min(100, Number($("sm-order").value) + 10)); recalculate(); });
$("guided-demo-activate").addEventListener("click", () => {
  const primary = findPrimaryTemperatureBottleneck(latestNetworkState?.withBooster.afterBranches ?? []);
  if (!selectedNetworkBranch) { $("demo-branch-feedback").textContent = translate("interaction.choose_branch"); return; }
  if (!primary) { $("demo-branch-feedback").textContent = translate("interaction.no_constraint"); return; }
  guidedDemoBooster.branchId = selectedNetworkBranch;
  gridBoosters = [{ ...guidedDemoBooster }];
  renderBoosterTray(); recalculate();
  const boostedBranch = latestNetworkState.withBooster.afterBranches.find(branch => branch.id === selectedNetworkBranch);
  demoConstraintAddressed = selectedNetworkBranch === primary.id && boostedBranch?.finalMargin >= 0;
  if (demoConstraintAddressed) $("demo-branch-feedback").textContent = translate("interaction.constraint_addressed", { branch: selectedNetworkBranch });
  else $("demo-branch-feedback").textContent = translate("interaction.constraint_remains", { branch: selectedNetworkBranch, primary: primary.id });
  recalculate();
});
$("hmp-target-slider").addEventListener("input", () => { $("hmp-target").value = $("hmp-target-slider").value; recalculate(); });
$("hmp-target").addEventListener("input", () => {
  const value = Number($("hmp-target").value);
  if (value >= 70 && value <= 95) $("hmp-target-slider").value = String(value);
  recalculate();
});
for (const id of ["outdoor-temp", "network-return-temp", "network-reference-delta", "plant-temp", "plant-power", "plant-availability", "plant-loss", "dc-temp", "dc-power", "dc-return-max-injection", "dc-availability", "dc-loss", "dc-mode", "dc-single-temp", "dc-single-cop", "dc-stage1-temp", "dc-stage1-cop", "dc-stage2-temp", "dc-stage2-cop", "booster-branch", "booster-setpoint", "network-cop", "booster-capacity", "source-temperature-strategy", "normal-plant-supply", "max-ramped-plant-supply", "plant-ramp-cost"]) $(id).addEventListener("input", recalculate);
for (const id of ["sm-enabled", "return-base-temp", "return-flow", "sm-temp", "sm-power", "sm-max-injection", "pip3-d-min-temp", "pip3-d-max-uptake", "pip3-e-min-temp", "pip3-e-max-uptake", "pip3-f-min-temp", "pip3-f-max-uptake", "dc-return-order", "sm-order", "pip3-d-order", "pip3-e-order", "pip3-f-order"]) $(id).addEventListener("input", recalculate);
$("network-view-selector").addEventListener("change", updateNetworkView);
for (const id of ["sweep-start", "sweep-end", "sweep-step", "electricity-price", "central-heat-cost", "waste-heat-cost"]) $(id).addEventListener("input", recalculate);
$("sensitivity-variable").addEventListener("change", () => { refreshSensitivityControls(true); $("sensitivity-validation").hidden = true; sensitivitySettingsChanged(); });
$("sensitivity-branch").addEventListener("change", () => { refreshSensitivityControls(true); sensitivitySettingsChanged(); });
$("sensitivity-stage").addEventListener("change", () => { refreshSensitivityControls(true); sensitivitySettingsChanged(); });
$("sensitivity-min").addEventListener("input", sensitivitySettingsChanged);
$("sensitivity-max").addEventListener("input", sensitivitySettingsChanged);
$("sensitivity-step").addEventListener("input", sensitivitySettingsChanged);
$("sensitivity-run").addEventListener("click", runSensitivityAnalysis);
$("sensitivity-reset").addEventListener("click", resetSensitivityRange);
$("sensitivity-metric").addEventListener("change", renderSensitivityResult);
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
  const casual = document.body.dataset.mode === "casual";
  const target = casual || $("booster-mode").value === "target";
  const defaults = scenarios[Number(scenarioSelect.value)] ?? scenarios[0];
  const copInput = Number($("network-cop").value), capacityInput = Number($("booster-capacity").value);
  const cop = Number.isFinite(copInput) && copInput > 1 ? copInput : defaults.cop;
  const capacity = Number.isFinite(capacityInput) && capacityInput > 0 ? capacityInput : defaults.capacity;
  const setpoint = Number($("booster-setpoint").value);
  const item = { id: allocateBoosterId(), branchId: "",
    mode: target ? "target" : "lift", targetTemp: target ? (Number.isFinite(setpoint) && setpoint > 0 ? setpoint : defaults.setpoint) : 0,
    liftK: target ? 0 : (Number.isFinite(setpoint) && setpoint > 0 ? setpoint : defaults.setpoint), cop, maxThermalKW: capacity };
  assignBoosterBranch(item, $("booster-branch").value === "none" ? "" : $("booster-branch").value);
  gridBoosters.push(item);
  renderBoosterTray(); recalculate();
});
const guidedDemoNetwork = $("guided-demo-network");
const networkMap = $("network-map");
const networkMapPlaceholder = $("network-map-placeholder");
function placeNetworkMapForMode(mode) {
  if (mode === "demo") guidedDemoNetwork.append(networkMap);
  else if (networkMapPlaceholder.parentElement)
    networkMapPlaceholder.parentElement.insertBefore(networkMap, networkMapPlaceholder.nextSibling);
}
placeNetworkMapForMode(document.body.dataset.mode);
syncWhyAccessPoints();
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
  syncWhyAccessPoints();
  placeNetworkMapForMode(mode);
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
  else applyGuidedDemoStep(guidedDemoStep + 1);
});
$("guided-demo-restart").addEventListener("click", restartGuidedDemo);
document.querySelectorAll("[data-demo-goto]").forEach(button => button.addEventListener("click", () => {
  const destination = Number(button.dataset.demoGoto);
  applyGuidedDemoStep(destination);
}));
$("dc-temp").value = "83";
$("dc-mode").value = "two-stage";
$("sensitivity-min").value = "20"; $("sensitivity-max").value = "120"; $("sensitivity-step").value = "10";
$("scenario-description").textContent = "Illustrative guided case: compare a 90 °C baseline with an 80 °C HMP target, using the same 83 °C data-center waste-heat source and a local booster on Branch A.";
refreshSensitivityControls(true);
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
