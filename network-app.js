import { simulateNetwork, calculateTemperatureFlexSweep, summarizeNetworkFlexState, calculateOperatingCost, lowestSupportedPoint, isReturnSourceAvailableToConsumer, calculatePip3HeatSplit, findPrimaryTemperatureBottleneck, MAX_PIP3_BRANCHES } from "./network-model.js?v=20261014-1";
import { analyzeSystemOpportunity, calculateOpportunityIntervention, calculateMarginalTemperature, calculateSourceTemperatureIntervention, clearScenarioSlot, compareScenarioSnapshots, restoreScenarioSnapshot, saveScenarioSlot } from "./network-insights.js?v=20261014-1";
import { buildSensitivityValues, calculateKeySensitivities, calculateSensitivitySweep, createSensitivitySpec, summarizeSensitivitySweep } from "./network-sensitivity.js?v=20261014-1";
import { createAnnualProfile, createOperatingBin, duplicateAnnualProfile, updateOperatingBin, calculateAnnualProfile, compareAnnualProfiles, calculateBusinessCase } from "./annual-analysis.js?v=20261014-1";

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
  { name: "1 — Conventional High-Temperature Grid", description: "The network works, but its high operating temperature blocks both available waste-heat sources.", purpose: "scenario.demo1.purpose", whatToTry: ["scenario.demo1.try1", "scenario.demo1.try2", "scenario.demo1.try3"], hmp: 90, outdoor: 2, plantTemp: 98, plantPower: 15, plantAvailability: 100, plantLoss: 2, dcTemp: 60, dcPower: 5, dcAvailability: 100, dcLoss: 2, industrialTemp: 78, industrialPower: 1.5, industrialAvailability: 100, industrialLoss: 1, dcMode: "one-stage", branch: "none", mode: "target", setpoint: 85, cop: 3, capacity: 2000, singleTemp: 75, singleCOP: 3, stage1Temp: 70, stage1COP: 3, stage2Temp: 85, stage2COP: 3, networkReturnTemp: 40, referenceNetworkDeltaK: null, gridBoosters: [], branchProfile: { A: { minimumSupplyTemp: 85 }, B: { minimumSupplyTemp: 79 }, C: { minimumSupplyTemp: 74 }, D: { minimumSupplyTemp: 70 }, E: { minimumSupplyTemp: 77 }, F: { minimumSupplyTemp: 68 } } },
  { name: "2 — Unlock Industrial Waste Heat", description: "Lowering HMP unlocks direct industrial heat; Branch A then needs a local temperature lift.", purpose: "scenario.demo2.purpose", whatToTry: ["scenario.demo2.try1", "scenario.demo2.try2", "scenario.demo2.try3"], hmp: 77, outdoor: 0, plantTemp: 95, plantPower: 15, plantAvailability: 100, plantLoss: 2, dcTemp: 60, dcPower: 5, dcAvailability: 100, dcLoss: 1.5, industrialTemp: 78, industrialPower: 1.5, industrialAvailability: 100, industrialLoss: 1, dcMode: "one-stage", branch: "A", mode: "target", setpoint: 85, cop: 3, capacity: 2000, singleTemp: 75, singleCOP: 3, stage1Temp: 70, stage1COP: 3, stage2Temp: 85, stage2COP: 3, networkReturnTemp: 40, referenceNetworkDeltaK: null, gridBoosters: [{ id: "GB-1", branchId: "A", mode: "target", targetTemp: 85, liftK: 0, cop: 3, maxThermalKW: 2000 }], branchProfile: { A: { minimumSupplyTemp: 85, lossToBranch: 2 }, B: { minimumSupplyTemp: 76 }, C: { minimumSupplyTemp: 74 }, D: { minimumSupplyTemp: 70 }, E: { minimumSupplyTemp: 75 }, F: { minimumSupplyTemp: 68 } } },
  { name: "3 — Upgrade Data-Center Waste Heat", description: "Compare raw, one-stage and two-stage delivery to see how heat-pump upgrading changes source eligibility and central production.", purpose: "scenario.demo3.purpose", whatToTry: ["scenario.demo3.try1", "scenario.demo3.try2", "scenario.demo3.try3"], hmp: 82, outdoor: 4, plantTemp: 98, plantPower: 15, plantAvailability: 100, plantLoss: 2, dcTemp: 50, dcPower: 5, dcAvailability: 100, dcLoss: 2, industrialTemp: 79, industrialPower: 0.5, industrialAvailability: 100, industrialLoss: 1, dcMode: "two-stage", branch: "none", mode: "target", setpoint: 85, cop: 3, capacity: 2000, singleTemp: 75, singleCOP: 3, stage1Temp: 70, stage1COP: 3, stage2Temp: 85, stage2COP: 3, networkReturnTemp: 40, referenceNetworkDeltaK: null, gridBoosters: [], branchProfile: { A: { minimumSupplyTemp: 80 }, B: { minimumSupplyTemp: 76 }, C: { minimumSupplyTemp: 74 }, D: { minimumSupplyTemp: 70 }, E: { minimumSupplyTemp: 76 }, F: { minimumSupplyTemp: 68 } } },
  { name: "4 — Local Gridbooster Strategy", description: "Keep HMP low to use both waste-heat sources while locally boosting only selected high-temperature branches.", purpose: "scenario.demo4.purpose", whatToTry: ["scenario.demo4.try1", "scenario.demo4.try2", "scenario.demo4.try3"], hmp: 74, outdoor: -4, plantTemp: 95, plantPower: 15, plantAvailability: 100, plantLoss: 2, dcTemp: 60, dcPower: 5, dcAvailability: 100, dcLoss: 2, industrialTemp: 78, industrialPower: 2, industrialAvailability: 100, industrialLoss: 1, dcMode: "two-stage", branch: "A", mode: "target", setpoint: 85, cop: 3, capacity: 2000, singleTemp: 75, singleCOP: 3, stage1Temp: 70, stage1COP: 3, stage2Temp: 85, stage2COP: 3, networkReturnTemp: 40, referenceNetworkDeltaK: null, gridBoosters: [{ id: "GB-1", branchId: "A", mode: "target", targetTemp: 85, liftK: 0, cop: 3, maxThermalKW: 2000 }], branchProfile: { A: { minimumSupplyTemp: 85, lossToBranch: 2 }, B: { minimumSupplyTemp: 79, lossToBranch: 1 }, C: { minimumSupplyTemp: 73, lossToBranch: 1 }, D: { minimumSupplyTemp: 70, lossToBranch: 2 }, E: { minimumSupplyTemp: 77, lossToBranch: 1 }, F: { minimumSupplyTemp: 68, lossToBranch: 2 } } },
  { name: "5 — Return Heat / PIP3 Network", description: "Return heat is useful only when the source is upstream in the flow direction and hot enough for a PIP3 branch.", purpose: "scenario.demo5.purpose", whatToTry: ["scenario.demo5.try1", "scenario.demo5.try2", "scenario.demo5.try3"], hmp: 90, outdoor: 2, plantTemp: 98, plantPower: 15, plantAvailability: 100, plantLoss: 2, dcTemp: 60, dcPower: 5, dcAvailability: 100, dcLoss: 1.5, industrialTemp: 68, industrialPower: 0.8, industrialAvailability: 90, industrialLoss: 2, dcMode: "raw-return", branch: "none", mode: "target", setpoint: 85, cop: 3, capacity: 2000, singleTemp: 75, singleCOP: 3, stage1Temp: 70, stage1COP: 3, stage2Temp: 85, stage2COP: 3, networkReturnTemp: 43, returnFlowM3h: 500, referenceNetworkDeltaK: null, dcReturnOrder: 5, smOrder: 25, supermarketEnabled: true, supermarketSourceTempC: 49, supermarketPowerKW: 3500, gridBoosters: [], returnHeatDemo: true, pip3: { B: { order: 60, maxReturnShare: 40, minimumUsableTempC: 45 }, E: { order: 30, maxReturnShare: 100, minimumUsableTempC: 44 }, F: { order: 20, maxReturnShare: 70, minimumUsableTempC: 46 } } },
  { name: "6 — Multi-Level Waste Heat System", description: "Use each source at its useful temperature level: direct industrial heat, upgraded data-center heat, return heat for PIP3 and local lift at Branch A.", purpose: "scenario.demo6.purpose", whatToTry: ["scenario.demo6.try1", "scenario.demo6.try2", "scenario.demo6.try3"], hmp: 80, outdoor: 2, plantTemp: 98, plantPower: 15, plantAvailability: 100, plantLoss: 2, dcTemp: 60, dcPower: 5, dcAvailability: 100, dcLoss: 1.5, industrialTemp: 82, industrialPower: 2, industrialAvailability: 100, industrialLoss: 1, dcMode: "two-stage", branch: "A", mode: "target", setpoint: 85, cop: 3, capacity: 2000, singleTemp: 75, singleCOP: 3, stage1Temp: 70, stage1COP: 3, stage2Temp: 85, stage2COP: 3, networkReturnTemp: 43, returnFlowM3h: 500, referenceNetworkDeltaK: null, dcReturnOrder: 5, smOrder: 25, supermarketEnabled: true, supermarketSourceTempC: 49, supermarketPowerKW: 3800, gridBoosters: [{ id: "GB-1", branchId: "A", mode: "target", targetTemp: 85, liftK: 0, cop: 3, maxThermalKW: 2000 }], returnHeatDemo: true, multiLevelWasteHeatDemo: true, pip3: { D: { order: 40, maxReturnShare: 40, minimumUsableTempC: 45 }, E: { order: 30, maxReturnShare: 100, minimumUsableTempC: 44 }, F: { order: 20, maxReturnShare: 70, minimumUsableTempC: 46 } }, branchProfile: { A: { minimumSupplyTemp: 85, lossToBranch: 1 }, B: { minimumSupplyTemp: 78 }, C: { minimumSupplyTemp: 74 }, D: { minimumSupplyTemp: 70 }, E: { minimumSupplyTemp: 76 }, F: { minimumSupplyTemp: 68 } } }
];
Object.assign(scenarios[0], { wastewaterTemp: 80, wastewaterPower: 2.5, wastewaterAvailability: 100, wastewaterLoss: 1 });
Object.assign(scenarios[1], { wastewaterTemp: 80, wastewaterPower: 0.2, wastewaterAvailability: 100, wastewaterLoss: 1 });
Object.assign(scenarios[2], { wastewaterTemp: 80, wastewaterPower: 2.5, wastewaterAvailability: 100, wastewaterLoss: 1 });
Object.assign(scenarios[3], { wastewaterTemp: 80, wastewaterPower: 2.5, wastewaterAvailability: 100, wastewaterLoss: 1 });
Object.assign(scenarios[4], { wastewaterTemp: 80, wastewaterPower: 2.5, wastewaterAvailability: 100, wastewaterLoss: 1 });
Object.assign(scenarios[5], { wastewaterTemp: 82, wastewaterPower: 2.5, wastewaterAvailability: 100, wastewaterLoss: 1,
  supermarketSourceTempC: 53,
  greenhouse: { enabled: true, maxDemandKW: 2500, minimumTemperatureC: 50, connectionMode: "auto" },
  absorptionCooling: { enabled: true, maxHeatInputKW: 500, minimumDrivingTempC: 80, thermalCOP: 0.7 } });
const branchControls = $("branch-controls");
const scenarioSelect = $("scenario-select");
const branchInputs = new Map();
let gridBoosters = [];
let nextBoosterId = 1;
let comparisonTargets = [75, 80, 82, 85];
let selectedNetworkBranch = "";
let selectedCasualBoosterId = "";
let casualBaseline = null;
let casualPriorNetworkView = "supply";
let casualPriorPrices = null;
let casualSliderHome = null;
let casualBoosterHome = null;
let selectedPip3Branch = "D";
let supermarketTopologySelected = false;
let bottleneckFound = false;
let demoConstraintAddressed = false;
let demoComparisonBaseline = false;
let latestNetworkState = null;
let scenarioSnapshots = { baseline: null, optionA: null, optionB: null };
let sensitivityResult = null;
let sensitivityKeyResults = [];
let sensitivityBaselineSignature = "";
let sensitivityStaleReason = "";
let annualProfiles = { baseline: createAnnualProfile(), project: createAnnualProfile() };
let annualAnalysis = null;
let annualProfileChanged = true;
let annualBinSequence = 1;
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

function addCasualBooster(branchId = "") {
  const defaults = scenarios[Number(scenarioSelect.value)] ?? scenarios[0];
  const item = { id: allocateBoosterId(), branchId: "", mode: "target", targetTemp: defaults.setpoint, liftK: 0, cop: defaults.cop, maxThermalKW: defaults.capacity };
  if (branchId) assignBoosterBranch(item, branchId);
  gridBoosters.push(item);
  renderBoosterTray(); recalculate();
}

function setCasualControls(active) {
  const slider = $("hmp-target-slider").parentElement;
  const addBooster = $("add-gridbooster"), tray = $("gridbooster-tray");
  const casualHost = $("casual-booster-host"), casualHmpHost = $("casual-hmp-host");
  if (active) {
    casualSliderHome = slider?.parentElement ?? casualSliderHome;
    casualBoosterHome = addBooster.parentElement ?? casualBoosterHome;
    casualHmpHost.append(slider);
    casualHost.append(addBooster, tray);
  } else {
    casualSliderHome?.append(slider);
    casualBoosterHome?.append(addBooster, tray);
  }
}

function allocateBoosterId() {
  while (gridBoosters.some(item => item.id === `GB-${nextBoosterId}`)) nextBoosterId++;
  return `GB-${nextBoosterId++}`;
}

for (const branch of branchDefaults) {
  const pip3Shares = { A: 30, B: 55, C: 40, D: 70, E: 100, F: 80 };
  const pip3Enabled = ["D", "E", "F"].includes(branch.id);
  const card = document.createElement("div");
  card.className = "branch-input-card";
  card.innerHTML = `<div class="branch-input-title"><b>BRANCH ${branch.id}</b><span>customer path</span></div>
    <label>Branch name <span class="branch-input-wrap"><input data-branch="${branch.id}" data-key="name" type="text" value="${escapeHtml(branchName(branch))}" data-default-branch-name="${branch.id}"></span></label>
    <label>Heat demand <span class="branch-input-wrap"><input data-branch="${branch.id}" data-key="demandKW" type="number" min="0" step="any" value="${branch.demandKW}"><b>kWth</b></span></label>
    <label>Minimum supply <span class="branch-input-wrap"><input data-branch="${branch.id}" data-key="minimumSupplyTemp" type="number" step="any" value="${branch.minimumSupplyTemp}"><b>°C</b></span></label>
    <details class="branch-advanced"><summary data-i18n="ia.advanced_inputs">ADVANCED INPUTS</summary>
      <label>Branch flow <span class="branch-input-wrap"><input data-branch="${branch.id}" data-key="flowM3h" type="number" min="0" step="any" value="${branch.flowM3h}"><b>m³/h</b></span></label>
      <label>HMP → branch ΔT loss <span class="branch-input-wrap"><input data-branch="${branch.id}" data-key="lossToBranch" type="number" min="0" step="any" value="${branch.lossToBranch}"><b>K</b></span></label>
      <details class="branch-return-advanced"><summary data-i18n="ia.branch_return">Optional branch return</summary><label>Branch return temperature <span class="branch-input-wrap"><input data-branch="${branch.id}" data-key="returnTemp" type="number" step="any" placeholder="—"><b>°C</b></span></label></details>
    </details>
    <label class="pip3-toggle"><input data-branch="${branch.id}" data-key="pip3Enabled" type="checkbox" ${pip3Enabled ? "checked" : ""}> <span data-i18n="return.three_pipe_connection">${escapeHtml(translate("return.three_pipe_connection"))}</span> <b>PIP3</b></label>
    <div class="pip3-settings" data-pip3-branch="${branch.id}" ${pip3Enabled ? "" : "hidden"}>
      <label><span data-i18n="return.max_share">${escapeHtml(translate("return.max_share"))}</span> <span class="branch-input-wrap"><input data-branch="${branch.id}" data-key="maxReturnShare" type="number" min="0" max="100" step="1" value="${pip3Shares[branch.id]}"><b>%</b></span></label>
      <label><span data-i18n="return.minimum_temp">${escapeHtml(translate("return.minimum_temp"))}</span> <span class="branch-input-wrap"><input data-branch="${branch.id}" data-key="minimumUsableTempC" type="number" step="any" value="45"><b>°C</b></span></label>
    </div>`;
  branchControls.append(card);
}
function updatePip3Controls(changed) {
  const toggles = [...branchControls.querySelectorAll("input")].filter(input => input.dataset.key === "pip3Enabled");
  let active = toggles.filter(toggle => toggle.checked).length;
  if (changed?.checked && active > MAX_PIP3_BRANCHES) {
    changed.checked = false;
    active--;
  }
  $("pip3-limit-feedback").textContent = active >= MAX_PIP3_BRANCHES || (changed?.checked === false && toggles.filter(toggle => toggle.checked).length >= MAX_PIP3_BRANCHES)
    ? translate("return.pip3_limit") : "";
  for (const toggle of toggles) {
    const settings = branchControls.querySelector(`[data-pip3-branch="${toggle.dataset.branch}"]`);
    if (settings) {
      settings.hidden = !toggle.checked;
      settings.querySelectorAll("input").forEach(input => { input.disabled = !toggle.checked; });
    }
    toggle.disabled = !toggle.checked && active >= MAX_PIP3_BRANCHES;
  }
  set("pip3-active-count", translate("return.pip3_count", { active, maximum: MAX_PIP3_BRANCHES }));
}
branchControls.addEventListener("change", event => {
  if (event.target.matches?.("input[data-key='pip3Enabled']")) {
    updatePip3Controls(event.target);
    recalculate();
  }
});
branchControls.addEventListener("input", event => {
  if (event.target.matches?.("input[data-key='maxReturnShare'],input[data-key='minimumUsableTempC']")) recalculate();
});
updatePip3Controls();
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
    const branchFields = [...values].filter(input => input.dataset.branch === branch.id);
    const fields = Object.fromEntries(branchFields.filter(input => input.type !== "checkbox").map(input => [input.dataset.key, input.value]));
    const enabled = branchFields.find(input => input.dataset.key === "pip3Enabled")?.checked ?? ["D", "E", "F"].includes(branch.id);
    return { ...branch, ...fields, returnTemp: fields.returnTemp === "" || fields.returnTemp == null ? null : Number(fields.returnTemp),
      pip3: { enabled, maxReturnShare: Number(fields.maxReturnShare ?? 100), minimumUsableTempC: Number(fields.minimumUsableTempC ?? 45) } };
  });
  const target = get("booster-mode") === "target";
  const rawReturnSelected = get("dc-mode") === "raw-return";
  const pip3Nodes = scenarioBranches.map(branch => ({
    id: branch.id, name: `${branch.pip3.enabled ? "PIP3 " : ""}Branch ${branch.id}`, branchId: branch.id, type: branch.pip3.enabled ? "THREE_PIPE_CONSUMER" : "RETURN_BRANCH",
    order: get(`pip3-${branch.id.toLowerCase()}-order`), enabled: branch.pip3.enabled,
    demandKW: branch.demandKW, minimumUsableTempC: branch.pip3.minimumUsableTempC,
    maxReturnShare: branch.pip3.maxReturnShare
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
    industrialWasteHeat: { sourceTempC: get("industrial-temp"), availableThermalKW: Number(get("industrial-power")) * 1000,
      availabilityPercent: get("industrial-availability"), lossToHMP: get("industrial-loss") },
    wastewaterHeat: { enabled: get("wastewater-enabled") === "true", sourceTempC: get("wastewater-temp"),
      availableThermalKW: Number(get("wastewater-power")) * 1000, availabilityPercent: get("wastewater-availability"), lossToHMP: get("wastewater-loss") },
    flexibleSinks: { greenhouse: { enabled: get("greenhouse-enabled") === "true", maxDemandKW: get("greenhouse-demand"),
      minimumTemperatureC: get("greenhouse-min-temp"), connectionMode: get("greenhouse-mode") },
      absorptionCooling: { enabled: get("absorption-enabled") === "true", maxHeatInputKW: get("absorption-capacity"),
        minimumDrivingTempC: get("absorption-min-temp"), thermalCOP: get("absorption-cop") } },
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
  const casual = document.body.dataset.mode === "casual";
  for (const item of gridBoosters) {
    const card = document.createElement("article");
    card.className = `gridbooster-token${item.branchId ? " placed" : " unplaced"}${selectedCasualBoosterId === item.id ? " selected" : ""}`;
    card.draggable = true; card.dataset.boosterId = item.id;
    if (casual) { card.tabIndex = 0; card.setAttribute("role", "button"); card.setAttribute("aria-pressed", String(selectedCasualBoosterId === item.id)); }
    const value = item.mode === "target" ? item.targetTemp : item.liftK;
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
  host.querySelectorAll(".gridbooster-token").forEach(token => token.addEventListener("click", () => {
    if (document.body.dataset.mode !== "casual") return;
    selectedCasualBoosterId = token.dataset.boosterId;
    recalculate();
  }));
  host.querySelectorAll(".gridbooster-token").forEach(token => token.addEventListener("keydown", event => {
    if (document.body.dataset.mode !== "casual" || !["Enter", " "].includes(event.key)) return;
    event.preventDefault(); selectedCasualBoosterId = token.dataset.boosterId; recalculate();
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
  if (document.body.dataset.mode === "casual" && selectedCasualBoosterId) {
    const booster = gridBoosters.find(item => item.id === selectedCasualBoosterId);
    if (booster) assignBoosterBranch(booster, branch.id);
    selectedCasualBoosterId = "";
    renderBoosterTray();
  }
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
    const casual = document.body.dataset.mode === "casual";
    const row = document.createElement("article");
    row.className = `network-branch-row ${status}${selected ? " selected" : ""}${!branch.feasibleWithoutBooster ? " needs-booster" : ""}`;
    row.dataset.branch = branch.id;
    row.tabIndex = 0; row.setAttribute("role", "button"); row.setAttribute("aria-pressed", String(selectedNetworkBranch === branch.id));
    const showWhy = document.body.dataset.mode === "demo";
    const boosters = branch.gridBoosters.map(item => casual
      ? `<div class="branch-booster-station casual-booster-station${selectedCasualBoosterId === item.id ? " selected" : ""}" draggable="true" tabindex="0" role="button" aria-pressed="${selectedCasualBoosterId === item.id}" data-booster-id="${item.id}" aria-label="${escapeHtml(translate("casual.select_booster", { id: item.id }))}"><span>⚡</span><b>${item.id}</b><span>${escapeHtml(translate("casual.boosted_to", { temperature: fmtTemp(branch.finalSupplyTemp) }))}</span><button type="button" data-casual-remove="${item.id}" aria-label="${escapeHtml(translate("interaction.remove_booster", { id: item.id }))}">×</button></div>`
      : `<div class="branch-booster-station" draggable="true" data-booster-id="${item.id}"><span>⚡</span><b>${item.id} · GRIDBOOSTER</b><small>IN ${fmt(item.inletTemp)} °C → OUT ${fmt(item.outletTemp)} °C</small><small>LIFT +${fmt(item.actualLiftK)} K · ${fmt(item.thermalPowerKW)} kWth</small><small>ELECTRIC ${fmt(item.electricalPowerKW)} kWe · COP ${fmt(item.cop, 2)}</small><small>MAX ${fmt(item.maxThermalKW)} kWth · ${item.capacitySufficient ? "✓ CAPACITY OK" : `! UNDERSIZED · ${fmt(item.requestedPowerKW - item.thermalPowerKW)} kWth short`}</small>${showWhy ? `<button type="button" class="network-why-button" data-inspect-kind="booster" data-i18n="interaction.why">WHY?</button>` : ""}${branch.feasibleWithoutBooster ? `<small class="booster-note">Booster installed — branch already feasible without local lift.</small>` : ""}</div>`).join("");
    const duty = branch.boosterActive ? `ACTUAL LOCAL DUTY ${fmt(branch.boosterThermalPowerKW)} kWth · ${fmt(branch.boosterElectricalPowerKW)} kWe` : `REQUIRED / HYPOTHETICAL DUTY ${fmt(branch.requiredBoosterPowerKW)} kWth`;
    const casualStatus = branch.boosterActive ? translate("casual.boosted")
      : branch.status === "unavailable" || branch.status === "below" ? translate("casual.too_cold")
        : branch.status === "close" ? translate("casual.close") : translate("casual.ok");
    const casualSummary = casual ? `<div class="casual-branch-summary"><b class="casual-branch-state">${casualStatus}</b>${branch.boosterActive ? `<span>${escapeHtml(translate("casual.boosted_to", { temperature: fmtTemp(branch.finalSupplyTemp) }))}</span>` : branch.margin < 0 ? `<span>${escapeHtml(translate("casual.needs_lift", { lift: fmt(-branch.margin) }))}</span>` : ""}${!branch.feasibleWithoutBooster && !branch.gridBoosters.length ? `<button type="button" class="casual-boost-action" data-casual-boost="${branch.id}">${escapeHtml(translate("casual.boost_branch"))}</button>` : ""}</div>` : "";
    row.innerHTML = `<div class="branch-pipe-connector"><span>${branch.id <= "C" ? "▲" : "▼"}</span></div><div class="branch-route-card">
      <div class="branch-route-head"><b class="branch-flag">${branch.id}</b><strong>${casual ? escapeHtml(translate("casual.branch", { branch: branch.id })) : `${escapeHtml(branch.name).toUpperCase()} · CUSTOMER LOAD`}</strong><span class="branch-status">${casual ? casualStatus : label}</span>${showWhy ? `<button type="button" class="network-why-button" data-why-branch="${branch.id}" data-i18n="interaction.why">WHY?</button>` : ""}</div>
      ${casualSummary}<div class="branch-route-values"><b class="branch-temp">TEMP CAPABILITY ${fmt(branch.availableSupplyTemp)} °C</b><span>MIN ${fmt(branch.minimumSupplyTemp)} °C</span><span>LOAD ${fmt(branch.demandKW / 1000, 2)} MWth</span><span>FLOW ${fmt(branch.flowM3h)} m³/h</span><span>HMP → BRANCH ΔT LOSS −${fmt(branch.lossToBranch)} K</span><span>CAPABILITY MARGIN ${fmt(branch.margin)} K</span><span>WITHOUT BOOSTER ${branch.feasibleWithoutBooster ? "✓ TEMP CAPABLE" : "! BELOW MINIMUM"}</span><span>${duty}</span></div>
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
    row.addEventListener("click", event => {
      if (event.target.closest?.("button,select,input,[draggable='true']")) return;
      if (event.target.className?.includes?.("casual-booster-station") || event.target.dataset?.casualRemove) return;
      selectNetworkBranch(branch);
    });
    row.addEventListener("keydown", event => { if ((event.key === "Enter" || event.key === " ") && event.target === row) { event.preventDefault(); selectNetworkBranch(branch); } });
    row.querySelector("[data-why-branch]")?.addEventListener("click", event => { event.stopPropagation(); inspectBranch(branch); });
    row.querySelectorAll("[data-booster-id]").forEach(token => token.addEventListener("dragstart", event => event.dataTransfer?.setData("text/plain", token.dataset.boosterId)));
    row.querySelectorAll(".casual-booster-station").forEach(token => token.addEventListener("click", event => { event.stopPropagation?.(); selectedCasualBoosterId = token.dataset.boosterId; recalculate(); }));
    row.querySelectorAll(".casual-booster-station").forEach(token => token.addEventListener("keydown", event => {
      if (!["Enter", " "].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation?.(); selectedCasualBoosterId = token.dataset.boosterId; recalculate();
    }));
    row.querySelectorAll("[data-casual-remove]").forEach(button => button.addEventListener("click", event => { event.stopPropagation?.(); gridBoosters = gridBoosters.filter(item => item.id !== button.dataset.casualRemove); selectedCasualBoosterId = ""; recalculate(); }));
    row.querySelectorAll("[data-casual-boost]").forEach(button => button.addEventListener("click", event => { event.stopPropagation?.(); addCasualBooster(button.dataset.casualBoost); }));
    hosts[branch.id <= "C" ? "top" : "bottom"].append(row);
  }
}

function renderProfile(result) {
  const svg = $("temperature-profile"); svg.replaceChildren();
  const points = [
    { label: "Plant", fullLabel: "Central heat plant contribution at HMP", temp: result.centralPlant.contributionTemp, source: true },
    { label: "DC", fullLabel: "Data-center path contribution after connection loss", temp: result.wasteHeat.contributionTemp, source: true },
    { label: "Industry", fullLabel: "Industrial Waste Heat contribution after source-to-HMP loss", temp: result.industrialWasteHeat.contributionTemp, source: true, sourceColor: "#2A9D8F" },
    { label: "HMP", fullLabel: "HMP target and temperature capability", temp: result.hmpTemperatureCapabilityTemp, minimum: result.hmpTargetTemp },
    ...result.afterBranches.map(branch => ({ label: branch.id, fullLabel: `Branch ${branch.id}: ${branch.name}`, temp: branch.finalSupplyTemp, minimum: branch.minimumSupplyTemp, status: branch.finalStatus }))
  ].filter(point => Number.isFinite(point.temp) && (point.label !== "Industry" || result.industrialWasteHeat.availableKW > 0));
  if (points.length < 2) return;
  const left = 58, right = 620, top = 20, bottom = 156;
  const low = Math.min(...points.map(point => Math.min(point.temp, point.minimum ?? point.temp))) - 4;
  const high = Math.max(...points.map(point => Math.max(point.temp, point.minimum ?? point.temp))) + 4;
  const x = index => left + (right - left) * index / (points.length - 1);
  const y = temp => bottom - (temp - low) / Math.max(high - low, 1) * (bottom - top);
  for (let i = 0; i <= 4; i++) { const value = high - (high - low) * i / 4, yy = y(value); svgNode(svg, "line", { x1: left, x2: right, y1: yy, y2: yy, class: "profile-grid" }); svgNode(svg, "text", { x: left - 8, y: yy + 4, "text-anchor": "end", class: "profile-axis" }, `${fmt(value, 0)}°`); }
  svgNode(svg, "polyline", { points: points.slice(2).map((point, index) => `${x(index + 2)},${y(point.temp)}`).join(" "), class: "profile-line" });
  points.forEach((point, index) => {
    const color = point.source ? (point.sourceColor ?? (index === 0 ? "#d99128" : "#47a96a")) : point.status === "below" || point.status === "boosted-below" ? "#e64c42" : point.status === "close" ? "#dd9b14" : point.status === "boosted" ? "#279c5e" : "#218fc1";
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
  const total = result.totalDemandKW, dataCenter = result.wasteHeatUsedKW, industrial = result.industrialWasteHeatUsedKW, unserved = result.hmpPowerShortfallKW;
  set("energy-caption", `${fmt(total / 1000, 2)} MW total customer heat demand`);
  const host = $("energy-split"); host.replaceChildren();
  for (const [label, value, cls] of [["Central plant", result.centralPlantUsedKW, "central-energy"], ["Data-center heat injected", dataCenter, "waste-energy"], ["Industrial waste heat injected", industrial, "industrial-energy"], ["Wastewater heat injected", result.wastewaterHeatUsedKW ?? 0, "wastewater-energy"], ["Unserved thermal requirement", unserved, "unserved-energy"]]) {
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
  const flexibleDCFraction = source.deliveredHeatKW > 0 ? Number(source.flexibleDeliveredHeatKW ?? 0) / source.deliveredHeatKW : 0;
  const centralCost = calculateOperatingCost({ centralPlantKW: after.centralPlantUsedKW }, prices);
  const rawHeatCost = calculateOperatingCost({ wasteHeatKW: sourceUsed + Number(after.returnHeatSourceCostKW ?? 0)
    + Number(source.sourceHeatKW ?? 0) * flexibleDCFraction }, prices);
  const industrialHeatCost = calculateOperatingCost({ industrialWasteHeatKW: after.industrialWasteHeatUsedKW
    + Number(after.industrialWasteHeat.flexibleUsedKW ?? 0) }, prices);
  const wastewaterHeatCost = calculateOperatingCost({ wastewaterHeatKW: after.wastewaterHeatUsedKW
    + Number(after.wastewaterHeat.flexibleUsedKW ?? 0) }, prices);
  const hpElectricCost = calculateOperatingCost({ electricPowerKW: after.dataCenterElectricPowerKW
    + Number(source.electricalPowerKW ?? 0) * flexibleDCFraction }, prices);
  const boosterElectricCost = calculateOperatingCost({ electricPowerKW: after.booster.electricalPowerKW }, prices);

  set("kpi-hmp-target", `${fmtTemp(after.hmpTargetTemp)} °C`);
  set("kpi-hmp", `${fmtTemp(after.hmpTargetTemp)} °C`);
  set("kpi-waste-share", share(after.totalWasteHeatUsedKW));
  set("kpi-central-share", share(after.centralPlantUsedKW));
  set("kpi-branch-lift", String(after.branchesNeedingBooster));
  set("kpi-electricity", `${fmt(metrics.totalSystemElectricKW)} kWe`);
  set("kpi-cost", `${fmt(metrics.operatingCostPerHour, 2)} €/h`);
  set("kpi-surplus-heat", `${fmt(metrics.surplusHeatKW / 1000, 2)} MW`);
  set("kpi-flexible-heat", `${fmt(metrics.flexibleSinkHeatKW / 1000, 2)} MW`);
  set("kpi-curtailed-heat", `${fmt(metrics.curtailedHeatKW / 1000, 2)} MW`);
  set("kpi-cooling-output", `${fmt(metrics.coolingOutputKW / 1000, 2)} MW`);

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
  set("summary-industrial-used", fmt(after.industrialWasteHeatUsedKW / 1000, 2));
  set("summary-industrial-available", fmt(after.industrialWasteHeat.availableKW / 1000, 2));
  set("summary-industrial-source-temp", fmtTemp(after.industrialWasteHeat.sourceTempC));
  set("summary-industrial-hmp-temp", fmtTemp(after.industrialWasteHeat.contributionTemp));
  set("summary-industrial-status", translate(after.industrialWasteHeat.status === "TEMPERATURE BLOCKED" ? "industry.temperature_blocked"
    : after.industrialWasteHeat.status === "INJECTING" ? "industry.injecting"
      : after.industrialWasteHeat.status === "UNAVAILABLE" ? "industry.unavailable" : "industry.available_idle"));
  set("map-wastewater-temp", `${fmt(after.wastewaterHeat.sourceTempC)} °C DELIVERED`);
  set("map-wastewater-contribution", `${fmt(after.wastewaterHeat.contributionTemp)} °C AT HMP · −${fmt(after.wastewaterHeat.lossToHMP)} K`);
  set("map-wastewater-power", `${fmt(after.wastewaterHeat.availableKW / 1000, 2)} MW AVAILABLE · ${fmt(after.wastewaterHeat.injectedKW / 1000, 2)} MW USED`);
  set("map-wastewater-status", after.wastewaterHeat.status === "TEMPERATURE BLOCKED" ? "TEMPERATURE BLOCKED"
    : after.wastewaterHeat.status === "INJECTING" ? "INJECTING" : after.wastewaterHeat.status === "UNAVAILABLE" ? "UNAVAILABLE" : "AVAILABLE · IDLE");
  $("map-wastewater-status").className = `mini-status ${after.wastewaterHeat.status === "INJECTING" ? "eligible" : after.wastewaterHeat.status === "TEMPERATURE BLOCKED" ? "ineligible" : ""}`;
  $("wastewater-node").classList.toggle("source-inactive", after.wastewaterHeat.injectedKW <= 0);
  $("wastewater-feed-pipe").classList.toggle("pipe-blocked", after.wastewaterHeat.injectedKW <= 0);
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
  set("cost-industrial-breakdown", `${fmt(industrialHeatCost, 2)} €/h`);
  set("cost-wastewater-breakdown", `${fmt(wastewaterHeatCost, 2)} €/h`);
  set("cost-cooling-revenue", `−${fmt(after.flexibleSinks.absorptionCooling.coolingRevenuePerHour, 2)} €/h`);
  set("cost-hp-breakdown", `${fmt(hpElectricCost, 2)} €/h`);
  set("cost-booster-breakdown", `${fmt(boosterElectricCost, 2)} €/h`);
  set("cost-ramp-breakdown", `${fmt(metrics.plantRampPenaltyPerHour, 2)} €/h`);
  set("cost-total-breakdown", `${fmt(metrics.operatingCostPerHour, 2)} €/h`);
  set("balance-demand", `${fmt(demand / 1000, 2)} MWth`);
  set("balance-central", `${fmt(after.centralPlantUsedKW / 1000, 2)} MWth`);
  set("balance-data-center", `${fmt(after.wasteHeatUsedKW / 1000, 2)} MWth`);
  set("balance-industrial", `${fmt(after.industrialWasteHeatUsedKW / 1000, 2)} MWth`);
  set("balance-unserved", `${fmt(after.hmpPowerShortfallKW / 1000, 2)} MWth`);
  $("balance-unserved-plus").hidden = after.hmpPowerShortfallKW <= 1e-9;
  $("balance-unserved-item").hidden = after.hmpPowerShortfallKW <= 1e-9;
  set("balance-booster-thermal", fmt(after.booster.thermalPowerKW, 1));
  set("balance-booster-electric", fmt(after.booster.electricalPowerKW, 1));
  $("normal-cost-electric-power").textContent = fmt(metrics.totalSystemElectricKW);
  $("normal-cost-central").textContent = `${fmt(centralCost, 2)} €/h`;
  $("normal-cost-electric").textContent = `${fmt(calculateOperatingCost({ electricPowerKW: metrics.totalSystemElectricKW }, prices), 2)} €/h`;
  $("normal-cost-waste").textContent = `${fmt(rawHeatCost, 2)} €/h`;
  $("normal-cost-industrial").textContent = `${fmt(industrialHeatCost, 2)} €/h`;
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
    wasteHeatKW: state.dataCenterSourceHeatUsedKW + Number(state.returnHeatSourceCostKW ?? 0),
    industrialWasteHeatKW: state.industrialWasteHeatUsedKW,
    wastewaterHeatKW: state.wastewaterHeatUsedKW,
    electricPowerKW: state.dataCenterElectricPowerKW + state.booster.electricalPowerKW }, prices)
    + Number(state.plantRampPenaltyPerHour ?? 0) - Number(state.flexibleSinks?.absorptionCooling.coolingRevenuePerHour ?? 0);
  const rows = [
    ["Temperature-critical branches", `${comparison.criticalBefore} / 6`, `${comparison.criticalAfter} / 6`],
    ["Waste heat utilized", `${fmt(result.without.totalWasteHeatUsedKW / 1000, 2)} MWth`, `${fmt(result.withBooster.totalWasteHeatUsedKW / 1000, 2)} MWth`],
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
  return { ...input, industrialWasteHeat: { ...input.industrialWasteHeat, availableThermalKW: 0 },
    wastewaterHeat: { ...input.wastewaterHeat, enabled: false }, flexibleSinks: { greenhouse: { enabled: false }, absorptionCooling: { enabled: false } },
    hmpTargetTemp, gridBoosters: boosters.map(item => ({ ...item })) };
}

function guidedOperatingCost(state, prices) {
  return calculateOperatingCost({ centralPlantKW: state.centralPlantUsedKW,
    wasteHeatKW: state.dataCenterSourceHeatUsedKW + Number(state.returnHeatSourceCostKW ?? 0), industrialWasteHeatKW: state.industrialWasteHeatUsedKW,
    wastewaterHeatKW: state.wastewaterHeatUsedKW,
    electricPowerKW: state.dataCenterElectricPowerKW + state.booster.electricalPowerKW }, prices)
    + Number(state.plantRampPenaltyPerHour ?? 0) - Number(state.flexibleSinks?.absorptionCooling.coolingRevenuePerHour ?? 0);
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
    const additionalHeatKW = optimized.totalWasteHeatUsedKW - baseline.totalWasteHeatUsedKW;
    const avoidedCentralCost = (baseline.centralPlantUsedKW - optimized.centralPlantUsedKW) * Number(prices.centralHeatCostPerMWh ?? 40) / 1000;
    const netBenefit = guidedOperatingCost(baseline, prices) - guidedOperatingCost(optimized, prices);
    const comparisonRows = [
      ["Central plant supply temperature", `${fmtTemp(baseline.centralPlant.supplyTemp)} °C`, `${fmtTemp(optimized.centralPlant.supplyTemp)} °C`],
      ["Central HMP target", `${fmtTemp(baseline.hmpTargetTemp)} °C`, `${fmtTemp(optimized.hmpTargetTemp)} °C`],
      ["Branches meeting minimum temperature", `${baseline.feasibleAfterCount} / 6`, `${optimized.feasibleAfterCount} / 6`],
      ["Available waste heat source", `${fmt(baseline.wasteHeat.availableKW / 1000, 2)} MWth`, `${fmt(optimized.wasteHeat.availableKW / 1000, 2)} MWth`],
      ["Waste heat utilized", `${fmt(baseline.totalWasteHeatUsedKW / 1000, 2)} MWth`, `${fmt(optimized.totalWasteHeatUsedKW / 1000, 2)} MWth`],
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
  return { electricityPricePerMWh: Number($("electricity-price").value), centralHeatCostPerMWh: Number($("central-heat-cost").value),
    wasteHeatCostPerMWh: Number($("waste-heat-cost").value), industrialWasteHeatCostPerMWh: Number($("industrial-heat-cost").value),
    wastewaterHeatCostPerMWh: Number($("wastewater-heat-cost").value), coolingPricePerMWh: Number($("cooling-price").value) };
}

function annualProfileKey() { return $("annual-profile-select").value; }
function markAnnualProfileChanged() {
  annualProfileChanged = true;
  $("annual-stale").hidden = !annualAnalysis;
  $("annual-results").hidden = true;
  renderAnnualProfile();
}
function annualStatusLabel(status) {
  const key = status === "SUPPORTED" ? "annual.supported" : status === "TEMPERATURE UNSUPPORTED" ? "annual.temperature_unsupported"
    : status === "BRANCH TEMPERATURE CONSTRAINT" ? "annual.branch_temperature_constraint"
      : status === "CAPACITY SHORTFALL" ? "annual.capacity_shortfall" : status === "INVALID BIN" ? "annual.invalid_bin" : "annual.not_calculated";
  return translate(key);
}
function annualFormat(value, unit = "MWh/year") {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  const scaled = unit.includes("MWh") && Math.abs(n) >= 10000 ? `${fmt(n / 1000, 1)} GWh/year` : `${fmt(n, Math.abs(n) >= 100 ? 0 : 1)} ${unit}`;
  return scaled;
}
function annualResultFor(key, id) { return annualAnalysis?.[key]?.bins?.find(item => item.bin.id === id); }
function annualCreateDemoProfile(input = readScenario(), prices = flexPrices()) {
  const specs = [
    ["annual.demo.bin.cold_peak", 180, -12, 90, "one-stage"],
    ["annual.demo.bin.cold_winter", 500, -7, 88, "one-stage"],
    ["annual.demo.bin.winter", 1000, -2, 85, "two-stage"],
    ["annual.demo.bin.mild_winter", 1500, 2, 82, "two-stage"],
    ["annual.demo.bin.shoulder", 1800, 7, 80, "two-stage"],
    ["annual.demo.bin.mild_shoulder", 1700, 12, 78, "one-stage"],
    ["annual.demo.bin.warm", 1200, 17, 76, "raw-return"],
    ["annual.demo.bin.low_load", 880, 22, 74, "raw-return"]
  ];
  return createAnnualProfile(specs.map(([labelKey, hoursPerYear, outdoorTemp, hmpTargetTemp, mode]) => {
    const state = JSON.parse(JSON.stringify({ input, prices }));
    state.input.outdoorTemp = outdoorTemp;
    state.input.hmpTargetTemp = hmpTargetTemp;
    state.input.wasteHeat.mode = mode;
    return { id: `demo-${annualBinSequence++}`, label: translate(labelKey), hoursPerYear, snapshot: { ...state, savedAt: null } };
  }));
}
function renderAnnualProfile() {
  const key = annualProfileKey();
  const profile = annualProfiles[key];
  const rows = profile.bins.map(bin => {
    const result = annualProfileChanged ? null : annualResultFor(key, bin.id);
    const state = result?.metrics;
    const input = result?.input ?? bin.snapshot.input;
    const temp = Number(input.outdoorTemp);
    const hmp = Number(input.hmpTargetTemp);
    const value = (kw) => state ? annualFormat(Number(kw) * Number(bin.hoursPerYear) / 1000) : "—";
    return `<tr><td><input class="annual-label-input" data-annual-label="${escapeHtml(bin.id)}" aria-label="${escapeHtml(translate("annual.label"))}" value="${escapeHtml(bin.label)}"></td><td><input class="annual-hours-input" data-annual-hours="${escapeHtml(bin.id)}" type="number" min="0" step="any" value="${escapeHtml(bin.hoursPerYear)}" aria-label="${escapeHtml(translate("annual.hours"))}"></td><td>${Number.isFinite(temp) ? `${fmtTemp(temp)} °C` : "—"}</td><td>${Number.isFinite(hmp) ? `${fmtTemp(hmp)} °C` : "—"}</td><td>${annualStatusLabel(result?.status)}</td><td>${value(state?.usableSupplyHeatKW)}</td><td>${value(state?.centralProductionKW)}</td><td>${value(state?.totalElectricKW)}</td><td>${state ? `€${fmt(state.operatingCostPerHour * Number(bin.hoursPerYear), 0)}` : "—"}</td><td class="annual-actions"><button type="button" data-annual-action="load" data-bin="${escapeHtml(bin.id)}">${escapeHtml(translate("annual.load"))}</button><button type="button" data-annual-action="update" data-bin="${escapeHtml(bin.id)}">${escapeHtml(translate("annual.update"))}</button><button type="button" data-annual-action="duplicate" data-bin="${escapeHtml(bin.id)}">${escapeHtml(translate("annual.duplicate_short"))}</button><button type="button" data-annual-action="remove" data-bin="${escapeHtml(bin.id)}">${escapeHtml(translate("annual.remove"))}</button></td></tr>`;
  }).join("");
  $("annual-bin-rows").innerHTML = rows || `<tr><td colspan="10">${escapeHtml(translate("annual.no_bins"))}</td></tr>`;
  const hours = profile.bins.reduce((sum, bin) => sum + (Number.isFinite(Number(bin.hoursPerYear)) && Number(bin.hoursPerYear) >= 0 ? Number(bin.hoursPerYear) : 0), 0);
  const delta = hours - 8760;
  $("annual-profile-hours").textContent = translate("annual.total_hours", { hours: fmt(hours, 0) });
  const warning = $("annual-hours-warning");
  warning.hidden = delta === 0;
  warning.textContent = delta < 0 ? translate("annual.missing", { hours: fmt(-delta, 0), total: fmt(hours, 0) })
    : translate("annual.exceeds", { hours: fmt(delta, 0), total: fmt(hours, 0) });
  if (annualAnalysis && !annualProfileChanged) renderAnnualResults();
}
function renderAnnualResults() {
  if (!annualAnalysis || annualProfileChanged) return;
  const comparison = annualAnalysis.comparison;
  const totals = comparison.totals;
  const saving = totals.operatingCostSaving;
  const signed = value => `${value >= 0 ? "+" : "−"}${annualFormat(Math.abs(value), "MWh/year")}`;
  $("annual-impact-cards").innerHTML = [
    ["annual.additional_heat", signed(totals.additionalUsableWasteHeatMWh)],
    ["annual.central_reduction", signed(totals.centralProductionReductionMWh)],
    ["annual.additional_electricity", signed(totals.additionalElectricityMWh)],
    [saving >= 0 ? "annual.cost_saving" : "annual.cost_increase", `€${fmt(Math.abs(saving), 0)}/year`],
    ["annual.supported_hours", `${fmt(comparison.project.totals.supportedHours, 0)} h/year`],
    ["annual.restored_hours", `${fmt(comparison.projectRestoresFeasibilityHours, 0)} h/year`],
    ["annual.comparable_hours", `${fmt(comparison.comparableHours, 0)} h/year`]
  ].map(([key, value]) => `<div><span>${escapeHtml(translate(key))}</span><b>${escapeHtml(value)}</b></div>`).join("");
  $("annual-comparison-scope").textContent = translate("annual.comparison_scope");
  const coverage = comparison.project.technicalCoverage;
  const pct = hours => coverage.totalHours > 0 ? hours / coverage.totalHours * 100 : 0;
  $("annual-coverage").innerHTML = `<b>${escapeHtml(translate("annual.technical_coverage"))}</b><div>${escapeHtml(translate("annual.supported"))}<strong>${fmt(coverage.supportedHours, 0)} h · ${fmt(pct(coverage.supportedHours), 1)}%</strong></div><div>${escapeHtml(translate("annual.temperature_unsupported"))}<strong>${fmt(coverage.temperatureUnsupportedHours, 0)} h · ${fmt(pct(coverage.temperatureUnsupportedHours), 1)}%</strong></div><div>${escapeHtml(translate("annual.branch_temperature_constraint"))}<strong>${fmt(coverage.branchTemperatureConstraintHours, 0)} h · ${fmt(pct(coverage.branchTemperatureConstraintHours), 1)}%</strong></div><div>${escapeHtml(translate("annual.capacity_shortfall"))}<strong>${fmt(coverage.capacityShortfallHours, 0)} h · ${fmt(pct(coverage.capacityShortfallHours), 1)}%</strong></div><div>${escapeHtml(translate("annual.invalid_hours"))}<strong>${fmt(coverage.invalidBinHours, 0)} h · ${fmt(pct(coverage.invalidBinHours), 1)}%</strong></div>`;
  const t = comparison.project.totals;
  $("annual-energy-summary").innerHTML = [
    ["annual.usable_heat", t.usableSupplyHeatMWh, "supply"], ["annual.dc_supply_heat", t.dataCenterSupplyHeatMWh, "supply"],
    ["annual.industrial_supply_heat", t.industrialSupplyHeatMWh, "supply"], ["annual.upgraded_supply", t.upgradedSupplyHeatMWh, "supply"],
    ["wastewater.name", t.wastewaterSupplyHeatMWh, "supply"], ["flex.greenhouse", t.greenhouseHeatUseMWh, "supply"],
    ["flex.absorption_cooling", t.absorptionHeatInputMWh, "supply"], ["flex.cooling_output", t.coolingOutputMWh, "supply"],
    ["flex.curtailed_heat", t.curtailedHeatMWh, "supply"],
    ["annual.raw_return", t.rawReturnHeatMWh, "return"], ["annual.other_return", t.otherReturnHeatMWh, "return"],
    ["annual.central_production", t.centralProductionMWh, "supply"], ["annual.gridbooster_heat", t.gridboosterThermalMWh, "supply"],
    ["annual.dc_electricity", t.dataCenterElectricMWh, "electric"], ["annual.booster_electricity", t.gridboosterElectricMWh, "electric"],
    ["annual.total_electricity", t.totalElectricMWh, "electric"], ["annual.supply_topup", t.supplyTopUpMWh, "supply"]
  ].map(([label, value, route]) => `<div class="annual-energy-row ${route}"><span>${escapeHtml(translate(label))} · ${escapeHtml(translate(`annual.route.${route}`))}</span><b>${annualFormat(value)}</b></div>`).join("");
  const baseCosts = comparison.baseline.totals, projectCosts = comparison.project.totals;
  $("annual-cost-summary").innerHTML = [
    ["annual.central_cost", baseCosts.centralHeatCost, projectCosts.centralHeatCost],
    ["annual.waste_cost", baseCosts.wasteHeatCost, projectCosts.wasteHeatCost],
    ["annual.industrial_waste_cost", baseCosts.industrialWasteHeatCost, projectCosts.industrialWasteHeatCost],
    ["wastewater.name", baseCosts.wastewaterHeatCost, projectCosts.wastewaterHeatCost],
    ["flex.cooling_output", -baseCosts.coolingRevenue, -projectCosts.coolingRevenue],
    ["annual.electricity_cost", baseCosts.electricityCost, projectCosts.electricityCost],
    ["annual.ramp_penalty", baseCosts.plantRampPenalty, projectCosts.plantRampPenalty],
    ["annual.total_cost", baseCosts.operatingCost, projectCosts.operatingCost]
  ].map(([label, baselineValue, projectValue]) => `<div class="annual-energy-row"><span>${escapeHtml(translate(label))} · ${escapeHtml(translate("annual.baseline"))} / ${escapeHtml(translate("annual.project"))}</span><b>€${fmt(baselineValue, 0)} / €${fmt(projectValue, 0)}</b></div>`).join("");
  $("annual-booster-summary").innerHTML = comparison.project.boosters.map(item => `<div class="annual-energy-row"><span>${escapeHtml(item.id)} · ${escapeHtml(translate("annual.branch"))} ${escapeHtml(item.branchId)}</span><b>${fmt(item.installedHours, 0)} ${escapeHtml(translate("annual.installed_hours"))} · ${fmt(item.activeHours, 0)} ${escapeHtml(translate("annual.active_hours"))} (${fmt(item.installedHours ? item.activeHours / item.installedHours * 100 : 0, 1)}%) · ${annualFormat(item.thermalMWh)} · ${annualFormat(item.electricMWh)} · ${fmt(item.peakThermalKW, 0)} kWth · ${fmt(item.maxLiftK, 1)} K</b></div>`).join("") || `<small>${escapeHtml(translate("annual.no_boosters"))}</small>`;
  $("annual-dc-summary").innerHTML = [
    ["annual.raw_return_hours", comparison.project.modes["raw-return"]],
    ["annual.one_stage_hours", comparison.project.modes["one-stage"]],
    ["annual.two_stage_hours", comparison.project.modes["two-stage"]],
    ["annual.source_heat_used", t.sourceHeatUsedMWh],
    ["annual.hp_electricity", t.dataCenterElectricMWh]
  ].map(([label, value]) => `<div class="annual-energy-row"><span>${escapeHtml(translate(label))}</span><b>${label.endsWith("hours") ? fmt(value, 0) + " h/year" : annualFormat(value)}</b></div>`).join("");
  $("annual-pip3-summary").innerHTML = Object.entries(t.pip3BySourceMWh).map(([source, value]) => `<div class="annual-energy-row"><span>${escapeHtml(source)}</span><b>${annualFormat(value)}</b></div>`).join("") || "—";
  const constraints = comparison.project.primaryConstraintHours;
  const constraintLabel = key => key === "none" ? translate("annual.no_constraint")
    : key.startsWith("branch-") ? translate("annual.branch_constraint", { branch: key.slice(7) })
      : key === "source-temperature" ? translate("annual.source_temperature_constraint")
        : key === "source-capacity" ? translate("annual.source_capacity_constraint")
          : key === "return-topology" ? translate("annual.return_topology_constraint") : key;
  $("annual-constraint-summary").innerHTML = Object.entries(constraints).map(([key, hours]) => `<div class="annual-energy-row"><span>${escapeHtml(constraintLabel(key))}</span><b>${fmt(hours, 0)} h/year</b></div>`).join("");
  $("annual-constraints-present").innerHTML = Object.entries(comparison.project.constraintPresentHours).map(([key, hours]) => `<div class="annual-energy-row"><span>${escapeHtml(constraintLabel(key))}</span><b>${fmt(hours, 0)} h/year</b></div>`).join("");
  const largestHeatBin = comparison.matched.filter(item => item.comparisonAvailable && item.deltas.additionalUsableWasteHeatMWh > 0).reduce((best, item) =>
    !best || item.deltas.additionalUsableWasteHeatMWh > best.deltas.additionalUsableWasteHeatMWh ? item : best, null);
  const expensiveBoosterBin = comparison.project.bins.filter(item => item.metrics?.supported && item.metrics.gridboosterElectricKW > 0).reduce((best, item) => {
    const cost = item.metrics.gridboosterElectricKW * Number(item.prices.electricityPricePerMWh ?? 0) * item.hours / 1000;
    return !best || cost > best.cost ? { item, cost } : best;
  }, null);
  const commonConstraint = Object.entries(constraints).filter(([name]) => name !== "none").sort((a, b) => b[1] - a[1])[0];
  $("annual-opportunities").innerHTML = `<b>${escapeHtml(translate("annual.opportunities"))}</b><div>${escapeHtml(translate("annual.largest_opportunity"))}<strong>${largestHeatBin ? `${escapeHtml(largestHeatBin.project.bin.label)} · ${annualFormat(largestHeatBin.deltas.additionalUsableWasteHeatMWh)}` : "—"}</strong></div><div>${escapeHtml(translate("annual.expensive_booster"))}<strong>${expensiveBoosterBin ? `${escapeHtml(expensiveBoosterBin.item.bin.label)} · €${fmt(expensiveBoosterBin.cost, 0)}/year` : "—"}</strong></div><div>${escapeHtml(translate("annual.common_constraint"))}<strong>${commonConstraint ? `${escapeHtml(constraintLabel(commonConstraint[0]))} · ${fmt(commonConstraint[1], 0)} h/year` : escapeHtml(translate("annual.no_constraint"))}</strong></div>`;
  const hoursDiffer = comparison.warnings.differentTotalHours;
  const binsDiffer = comparison.warnings.differentBinIds;
  const priceSets = [...comparison.baseline.bins, ...comparison.project.bins].filter(bin => bin.prices).map(bin => JSON.stringify(bin.prices));
  const pricesDiffer = new Set(priceSets).size > 1;
  const binHoursWarnings = comparison.warnings.binHoursDiffer.map(item => {
    const matchedBin = comparison.matched.find(bin => bin.id === item.id);
    return translate("annual.bin_hours_differ", { bin: matchedBin?.project?.bin.label ?? item.id,
      baseline: fmt(item.baselineHours, 0), project: fmt(item.projectHours, 0) });
  });
  const warningText = [hoursDiffer && translate("annual.hours_differ"), binsDiffer && translate("annual.bins_differ"),
    comparison.warnings.assumptionsDiffer && translate("annual.assumptions_differ"), pricesDiffer && translate("annual.bin_prices")].filter(Boolean);
  $("annual-matched-bins").innerHTML = `<p class="annual-assumptions">${escapeHtml([...warningText, ...binHoursWarnings].join(" · ") || translate("annual.price_assumptions", { electricity: fmt(comparison.project.bins[0]?.prices?.electricityPricePerMWh ?? 0, 1), central: fmt(comparison.project.bins[0]?.prices?.centralHeatCostPerMWh ?? 0, 1), waste: fmt(comparison.project.bins[0]?.prices?.wasteHeatCostPerMWh ?? 0, 1), industrial: fmt(comparison.project.bins[0]?.prices?.industrialWasteHeatCostPerMWh ?? 5, 1) }))}</p><div class="strategy-table-wrap"><table class="strategy-comparison-table annual-table"><thead><tr><th>${escapeHtml(translate("annual.bin"))}</th><th>${escapeHtml(translate("annual.status"))}</th><th>${escapeHtml(translate("annual.heat_delta"))}</th><th>${escapeHtml(translate("annual.central_delta"))}</th><th>${escapeHtml(translate("annual.electricity_delta"))}</th><th>${escapeHtml(translate("annual.cost_delta"))}</th></tr></thead><tbody>${comparison.matched.map(item => `<tr><th>${escapeHtml(item.project?.bin.label ?? item.baseline?.bin.label ?? item.id)}</th><td>${item.baselineOnly ? escapeHtml(translate("annual.baseline_only")) : item.comparisonAvailable ? escapeHtml(translate("annual.direct_available")) : item.baselineUnsupportedProjectSupported ? escapeHtml(translate("annual.restores_feasibility")) : escapeHtml(translate("annual.direct_unavailable"))}${item.hoursDiffer ? `<small> · ${escapeHtml(translate("annual.bin_hours_differ_label"))}</small>` : ""}</td><td>${item.deltas ? signed(item.deltas.additionalUsableWasteHeatMWh) : "—"}</td><td>${item.deltas ? signed(item.deltas.centralProductionReductionMWh) : "—"}</td><td>${item.deltas ? signed(item.deltas.additionalElectricityMWh) : "—"}</td><td>${item.deltas ? item.deltas.operatingCostSaving >= 0 ? `€${fmt(item.deltas.operatingCostSaving, 0)} ${escapeHtml(translate("annual.cost_saving"))}` : `€${fmt(Math.abs(item.deltas.operatingCostSaving), 0)} ${escapeHtml(translate("annual.cost_increase"))}` : "—"}</td></tr>`).join("")}</tbody></table></div>`;
  renderAnnualChart();
  $("annual-assumptions-summary").innerHTML = `<div class="annual-assumption-line">${escapeHtml(translate("annual.profile_hours"))}: <b>${fmt(comparison.project.totalHours, 0)} h/year</b></div><div class="annual-assumption-line">${escapeHtml(translate("annual.capex"))}: <b>€${fmt(Number($("annual-capex").value || 0), 0)}</b> · ${escapeHtml(translate("annual.om"))}: <b>€${fmt(Number($("annual-fixed-om").value || 0), 0)}/year</b> · ${escapeHtml(translate("annual.other"))}: <b>€${fmt(Number($("annual-other-benefit").value || 0), 0)}/year</b></div><div class="annual-assumption-line">${escapeHtml(translate("annual.analysis_basis"))}: <b>${escapeHtml(pricesDiffer ? translate("annual.bin_prices") : translate("annual.price_assumptions", { electricity: fmt(comparison.project.bins[0]?.prices?.electricityPricePerMWh ?? 0, 1), central: fmt(comparison.project.bins[0]?.prices?.centralHeatCostPerMWh ?? 0, 1), waste: fmt(comparison.project.bins[0]?.prices?.wasteHeatCostPerMWh ?? 0, 1), industrial: fmt(comparison.project.bins[0]?.prices?.industrialWasteHeatCostPerMWh ?? 5, 1) }))}</b> · ${escapeHtml(translate("annual.period"))}: <b>${escapeHtml($("annual-period").value || "—")}</b> · ${escapeHtml(translate("annual.discount"))}: <b>${escapeHtml($("annual-discount").value || "—")}%</b></div>`;
  const business = calculateBusinessCase(comparison, { capex: $("annual-capex").value, annualFixedOM: $("annual-fixed-om").value,
    annualOtherBenefit: $("annual-other-benefit").value, analysisPeriodYears: $("annual-period").value || null,
    discountRatePercent: $("annual-discount").value || null });
  const cash = value => `€${fmt(Math.abs(value), 0)}/year ${escapeHtml(translate(value >= 0 ? "annual.cost_saving" : "annual.cost_increase"))}`;
  $("annual-business-results").innerHTML = `<div class="annual-business-metrics"><div><span>${escapeHtml(translate("annual.cost_saving"))}</span><b>€${fmt(Math.abs(saving), 0)}/year ${escapeHtml(translate(saving >= 0 ? "annual.cost_saving" : "annual.cost_increase"))}</b></div><div><span>${escapeHtml(translate("annual.additional_electricity"))}</span><b>${signed(totals.additionalElectricityMWh)}</b></div><div><span>${escapeHtml(translate("annual.additional_heat"))}</span><b>${signed(totals.additionalUsableWasteHeatMWh)}</b></div><div><span>${escapeHtml(translate("annual.central_reduction"))}</span><b>${signed(totals.centralProductionReductionMWh)}</b></div><div><span>${escapeHtml(translate("annual.net_benefit"))}</span><b>${cash(business.annualNetBenefit)}</b></div><div><span>${escapeHtml(translate("annual.simple_payback"))}</span><b>${business.simplePaybackYears == null ? escapeHtml(translate("annual.no_payback")) : `${fmt(business.simplePaybackYears, 1)} ${escapeHtml(translate("annual.years"))}`}</b></div><div><span>${escapeHtml(translate("annual.break_even_5"))}</span><b>€${fmt(business.breakEvenCapex5Year, 0)}</b></div><div><span>${escapeHtml(translate("annual.break_even_10"))}</span><b>€${fmt(business.breakEvenCapex10Year, 0)}</b></div>${business.simplifiedNpv == null ? "" : `<div><span>${escapeHtml(translate("annual.simplified_npv"))}</span><b>€${fmt(business.simplifiedNpv, 0)} · ${escapeHtml(translate("annual.constant_benefit"))}</b></div>`}</div>`;
}
function renderAnnualChart() {
  if (!annualAnalysis) return;
  const svg = $("annual-chart"); svg.replaceChildren();
  const metric = $("annual-chart-metric").value;
  const bins = annualAnalysis.comparison.matched.filter(item => item.comparisonAvailable);
  const values = bins.map(item => ({ label: item.project.bin.label, value: metric === "cost" ? item.deltas.operatingCostSaving
    : metric === "heat" ? item.deltas.additionalUsableWasteHeatMWh : metric === "central" ? item.deltas.centralProductionReductionMWh
      : metric === "electricity" ? item.deltas.additionalElectricityMWh : item.project.metrics.gridboosterElectricKW * item.project.hours / 1000 }));
  if (!values.length) return;
  const left = 48, top = 18, width = 685, height = 160;
  const low = Math.min(0, ...values.map(item => item.value)), high = Math.max(0, ...values.map(item => item.value));
  const span = high - low || 1, y = value => top + (high - value) / span * height, zero = y(0);
  svgNode(svg, "line", { x1: left, y1: zero, x2: left + width, y2: zero, class: "annual-axis" });
  const step = width / values.length, barWidth = Math.min(45, step * 0.58);
  values.forEach((item, index) => {
    const x = left + step * index + (step - barWidth) / 2, yy = y(item.value), barHeight = Math.max(1, Math.abs(zero - yy));
    svgNode(svg, "rect", { x, y: Math.min(yy, zero), width: barWidth, height: barHeight, class: `annual-bar ${item.value < 0 ? "negative" : ""}` });
    svgNode(svg, "text", { x: x + barWidth / 2, y: top + height + 17, "text-anchor": "middle", class: "annual-axis-label" }, `${index + 1}`);
    svgNode(svg, "title", {}, `${item.label}: ${fmt(item.value, 1)}`);
  });
  svgNode(svg, "text", { x: left, y: 12, class: "annual-axis-label" }, `${fmt(low, 1)} … ${fmt(high, 1)} ${metric === "cost" ? "€" : "MWh/year"}`);
  $("annual-chart").setAttribute("aria-label", translate("annual.chart_accessible"));
}
function runAnnualAnalysis() {
  const comparison = compareAnnualProfiles(annualProfiles.baseline, annualProfiles.project);
  annualAnalysis = { baseline: comparison.baseline, project: comparison.project, comparison };
  annualProfileChanged = false;
  $("annual-stale").hidden = true;
  $("annual-results").hidden = false;
  renderAnnualProfile();
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
    ["WASTE HEAT", `${fmt(point.usableWasteHeatKW)} kW`, `Data center ${fmt(point.usableDataCenterHeatKW)} kW · Industrial ${fmt(point.industrialWasteHeatUsedKW)} kW`],
    ["INDUSTRIAL SOURCE", `${fmt(point.industrialWasteHeatUsedKW)} kWth`, `${point.industrialWasteHeatTemperatureEligible ? "TEMPERATURE ELIGIBLE" : "TEMPERATURE BLOCKED"} · ${fmt(point.industrialWasteHeatAvailableKW)} kW available`],
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
  const industrialEligible = points.filter(point => point.industrialWasteHeatAvailableKW > 0 && point.industrialWasteHeatTemperatureEligible);
  pathPoints.push(["INDUSTRIAL WASTE HEAT USABLE UP TO:", !industrialEligible.length ? "TEMPERATURE BLOCKED ACROSS SWEEP"
    : industrialEligible.length === points.length ? "AVAILABLE ACROSS SWEEP" : `${fmtTemp(industrialEligible.at(-1).hmpTargetTemp)} °C HMP`]);
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
  const rows = [["raw-return", "RAW RETURN"], ["one-stage", "ONE-STAGE SUPPLY"], ["two-stage", "TWO-STAGE SUPPLY"], ["industrial", "INDUSTRIAL DIRECT SUPPLY"]].map(([mode, label]) => {
    const eligible = mode === "industrial" ? points.filter(point => point.industrialWasteHeatAvailableKW > 0 && point.industrialWasteHeatTemperatureEligible)
      : points.filter(point => point.dataCenterModeEligibility[mode]);
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
    "source-capacity": "analysis.source_capacity", "return-topology": "analysis.return_topology", "demand-limited": "analysis.demand_limited",
    "greenhouse-opportunity": "analysis.greenhouse_opportunity", "absorption-cooling-opportunity": "analysis.absorption_cooling_opportunity",
    "absorption-cooling-temperature": "analysis.absorption_cooling_temperature", none: "analysis.no_active_constraint" })[type] ?? "analysis.no_active_constraint");
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
    detail = `${primary.sourceName ? `${escapeHtml(primary.sourceName)} · ` : ""}${escapeHtml(translate("analysis.source_shortfall", { capability: fmtTemp(primary.capabilityTempC), target: fmtTemp(primary.targetTempC), shortfall: fmt(primary.shortfallK, 1) }))}`;
    const modes = result.withBooster.dataCenterModes ?? {};
    const alternateAvailable = ["one-stage", "two-stage"].some(key => key !== input.wasteHeat.mode && modes[key]?.injectionEligible);
    action = translate(alternateAvailable ? "analysis.source_upgrade_action" : "analysis.lower_hmp_action");
  } else if (primary.type === "source-capacity") {
    detail = escapeHtml(translate("analysis.capacity_shortfall", { shortfall: fmt(primary.shortfallKW, 0) }));
    action = translate("analysis.capacity_action");
  } else if (primary.type === "return-topology") {
    detail = escapeHtml(translate("analysis.return_blocked", { source: primary.sourceId, consumer: primary.consumerId }));
    action = translate("analysis.topology_action", { source: primary.sourceId, consumer: primary.consumerId });
  } else if (primary.type === "demand-limited") {
    detail = escapeHtml(translate("analysis.demand_limited_detail", { surplus: fmt(primary.surplusHeatKW / 1000, 2), curtailed: fmt(primary.curtailedHeatKW / 1000, 2) }));
    action = translate("analysis.flexible_sink_action");
  } else if (primary.type === "greenhouse-opportunity") {
    detail = escapeHtml(translate("analysis.greenhouse_opportunity_detail", { surplus: fmt(primary.surplusHeatKW / 1000, 2) }));
    action = translate("analysis.flexible_sink_action");
  } else if (primary.type === "absorption-cooling-opportunity" || primary.type === "absorption-cooling-temperature") {
    detail = escapeHtml(translate(primary.type === "absorption-cooling-temperature" ? "analysis.absorption_cooling_temperature_detail" : "analysis.absorption_cooling_detail", { temperature: fmtTemp(primary.minimumTempC) }));
    action = translate("analysis.flexible_sink_action");
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
  let casualMessage = translate("casual.no_constraint");
  if (primary.type === "branch-temperature") {
    casualMessage = `${translate("casual.branch_limiting", { branch: primary.branchId })} ${translate(intervention.resolved ? "casual.branch_boost_restores" : "casual.branch_boost_needed", { branch: primary.branchId })}`;
  } else if (primary.type === "source-temperature") {
    casualMessage = sourceIntervention?.additionalUsableHeatKW > 5
      ? translate("casual.source_unlocked", { heat: fmt(sourceIntervention.additionalUsableHeatKW / 1000) })
      : translate("casual.source_unavailable");
  } else if (primary.type === "source-capacity") casualMessage = translate("casual.capacity_short");
  else if (primary.type === "return-topology") casualMessage = translate("casual.return_blocked");
  $("opportunity-casual").innerHTML = `<div class="opportunity-compact casual-opportunity-copy"><section><span>${escapeHtml(translate("casual.unlock"))}</span><b>${escapeHtml(translate("casual.system_result"))}</b><p>${escapeHtml(casualMessage)}</p></section></div>`;

  const allConstraints = summary.constraints.length ? summary.constraints.map(item => {
    if (item.type === "branch-temperature") return `<li><b>${escapeHtml(opportunityTypeLabel(item.type))} · ${item.branchId}</b><span>${fmtTemp(item.availableTempC)} °C → ${fmtTemp(item.requiredTempC)} °C · ${fmt(item.deficitK, 1)} K</span></li>`;
    if (item.type === "source-temperature") return `<li><b>${item.sourceName ? `${escapeHtml(translate("industry.name"))} · ` : ""}${escapeHtml(opportunityTypeLabel(item.type))}</b><span>${fmtTemp(item.capabilityTempC)} °C capability · ${fmtTemp(item.targetTempC)} °C target · ${fmt(item.shortfallK, 1)} K short</span></li>`;
    if (item.type === "source-capacity") return `<li><b>${escapeHtml(opportunityTypeLabel(item.type))}</b><span>${fmt(item.shortfallKW, 0)} kW short</span></li>`;
    if (item.type === "demand-limited") return `<li><b>${escapeHtml(opportunityTypeLabel(item.type))}</b><span>${fmt(item.surplusHeatKW / 1000, 2)} MW eligible surplus · ${fmt(item.curtailedHeatKW / 1000, 2)} MW curtailed</span></li>`;
    if (item.type.startsWith("greenhouse-") || item.type.startsWith("absorption-cooling-")) return `<li><b>${escapeHtml(opportunityTypeLabel(item.type))}</b><span>${item.minimumTempC == null ? "" : `${fmtTemp(item.minimumTempC)} °C minimum`}</span></li>`;
    return `<li><b>${escapeHtml(opportunityTypeLabel(item.type))}</b><span>${escapeHtml(item.sourceId)} → ${escapeHtml(item.consumerId)}</span></li>`;
  }).join("") : `<li><b>${escapeHtml(translate("analysis.no_active_constraint"))}</b></li>`;
  $("opportunity-engineer").innerHTML = `<div class="opportunity-engineering"><section><span>${escapeHtml(translate("analysis.primary_constraint"))}</span><b>${escapeHtml(opportunityTypeLabel(primary.type))}</b><p>${detail}</p>${primary.type === "none" ? "" : `<small>${escapeHtml(action)}</small>`}</section><section><span>${escapeHtml(translate("analysis.primary_bottleneck"))}</span><ul>${allConstraints}</ul></section>${valueMarkup}</div>`;
}

const scenarioSlotNames = ["baseline", "optionA", "optionB"];
const scenarioSlotLabel = name => translate(`analysis.${name === "baseline" ? "baseline" : name === "optionA" ? "option_a" : "option_b"}`);

function setControlValue(id, value) {
  const element = document.getElementById(id);
  if (!element || value == null) return;
  if (element.type === "checkbox") element.checked = Boolean(value);
  else element.value = String(value);
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
    "waste-heat-cost": prices.wasteHeatCostPerMWh, "industrial-heat-cost": prices.industrialWasteHeatCostPerMWh ?? 10,
    "wastewater-heat-cost": prices.wastewaterHeatCostPerMWh ?? 25, "cooling-price": prices.coolingPricePerMWh ?? 50,
    "wastewater-enabled": input.wastewaterHeat?.enabled ?? false, "wastewater-temp": input.wastewaterHeat?.sourceTempC ?? 80,
    "wastewater-power": Number(input.wastewaterHeat?.availableThermalKW ?? 2500) / 1000,
    "wastewater-availability": input.wastewaterHeat?.availabilityPercent ?? 100, "wastewater-loss": input.wastewaterHeat?.lossToHMP ?? 1,
    "greenhouse-enabled": input.flexibleSinks?.greenhouse?.enabled ?? false,
    "greenhouse-demand": Number(input.flexibleSinks?.greenhouse?.maxDemandKW ?? 2500) / 1000,
    "greenhouse-min-temp": input.flexibleSinks?.greenhouse?.minimumTemperatureC ?? 50,
    "greenhouse-mode": input.flexibleSinks?.greenhouse?.connectionMode ?? "auto",
    "absorption-enabled": input.flexibleSinks?.absorptionCooling?.enabled ?? false,
    "absorption-capacity": Number(input.flexibleSinks?.absorptionCooling?.maxHeatInputKW ?? 2000) / 1000,
    "absorption-min-temp": input.flexibleSinks?.absorptionCooling?.minimumDrivingTempC ?? 80,
    "absorption-cop": input.flexibleSinks?.absorptionCooling?.thermalCOP ?? 0.7,
    "industrial-temp": input.industrialWasteHeat?.sourceTempC ?? 78,
    "industrial-power": Number(input.industrialWasteHeat?.availableThermalKW ?? 1500) / 1000,
    "industrial-availability": input.industrialWasteHeat?.availabilityPercent ?? 100,
    "industrial-loss": input.industrialWasteHeat?.lossToHMP ?? 1 };
  for (const [id, value] of Object.entries(direct)) setControlValue(id, value);
  for (const field of branchControls.querySelectorAll("input[data-branch][data-key]")) {
    const branch = input.branches.find(item => item.id === field.dataset.branch);
    const node = (input.returnNetwork?.nodes ?? []).find(item => item.id === field.dataset.branch);
    if (field.dataset.key === "pip3Enabled") field.checked = node ? node.type === "THREE_PIPE_CONSUMER" && node.enabled !== false
      : branch?.pip3?.enabled ?? ["D", "E", "F"].includes(field.dataset.branch);
    else if (field.dataset.key === "maxReturnShare") field.value = String(node?.maxReturnShare ?? branch?.pip3?.maxReturnShare ?? ({ A: 30, B: 55, C: 40, D: 70, E: 100, F: 80 }[field.dataset.branch]));
    else if (field.dataset.key === "minimumUsableTempC") field.value = String(node?.minimumUsableTempC ?? branch?.pip3?.minimumUsableTempC ?? 45);
    else if (branch && Object.hasOwn(branch, field.dataset.key)) field.value = branch[field.dataset.key] ?? "";
  }
  const nodeById = new Map((input.returnNetwork?.nodes ?? []).map(node => [node.id, node]));
  const returnControlMap = { "return-base-temp": input.returnNetwork?.baseReturnTempC, "return-flow": input.returnNetwork?.returnFlowM3h,
    "dc-return-order": nodeById.get("DC-RETURN")?.order, "dc-return-max-injection": nodeById.get("DC-RETURN")?.maxInjectionKW,
    "sm-enabled": nodeById.get("SM-1")?.enabled === false ? "false" : "true", "sm-order": nodeById.get("SM-1")?.order,
    "sm-temp": nodeById.get("SM-1")?.sourceTempC, "sm-power": nodeById.get("SM-1")?.availableKW, "sm-max-injection": nodeById.get("SM-1")?.maxInjectionKW };
  for (const branch of branchDefaults) returnControlMap[`pip3-${branch.id.toLowerCase()}-order`] = nodeById.get(branch.id)?.order;
  for (const [id, value] of Object.entries(returnControlMap)) setControlValue(id, value);
  setControlValue("cooling-price", prices.coolingPricePerMWh ?? 50);
  const dcReturn = nodeById.get("DC-RETURN");
  if (dcReturn) setControlValue("dc-return-max-injection", dcReturn.maxInjectionKW);
  gridBoosters = (input.gridBoosters ?? []).map(item => ({ ...item }));
  nextBoosterId = Math.max(1, ...gridBoosters.map(item => {
    const match = String(item.id).match(/^GB-(\d+)$/); return match ? Number(match[1]) + 1 : 1;
  }));
  const liftMode = input.booster.mode === "lift";
  $("booster-setpoint-label").textContent = liftMode ? "Booster temperature lift" : "Target branch supply";
  $("booster-setpoint-unit").textContent = liftMode ? "K" : "°C";
  updatePip3Controls();
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
  const gridRows = (local ? [{ hmpTargetTemp: local.current.hmpTargetTemp, heat: local.current.usableWasteHeatKW }, { hmpTargetTemp: local.lower.hmpTargetTemp, heat: local.lower.usableWasteHeatKW }] : [])
    .concat(points.filter(point => Number(point.hmpTargetTemp) < Number(local?.lower.hmpTargetTemp ?? currentTarget) - 1e-7).map(point => ({ hmpTargetTemp: point.hmpTargetTemp, heat: point.usableWasteHeatKW })))
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
const sensitivityEventKey = type => ({ "source-eligibility": "sensitivity.source_becomes_usable", "industrial-source-eligibility": "sensitivity.industrial_source_becomes_usable", "branch-constraint": "sensitivity.branch_constrained", "booster-activation": "sensitivity.booster_active", "booster-capacity": "sensitivity.booster_capacity", "operating-point-support": "sensitivity.operating_unsupported", "return-heat-eligibility": "sensitivity.return_unusable" })[type] ?? "sensitivity.invalid";
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
  if (event.type === "industrial-source-eligibility") return translate("sensitivity.industrial_source_becomes_usable", { status: event.detail ? translate("industry.injecting") : translate("industry.temperature_blocked") });
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
    drawFlexChart("flex-chart-waste", points, "usableWasteHeatKW", "MW", input.hmpTargetTemp, null, 0.001);
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
  $("return-pipe").innerHTML = [...state.nodes].reverse().map(node => {
    if (node.type === "CENTRAL_PLANT") return `<div class="return-node plant-return-node"><svg class="source-icon plant-icon return-node-icon" viewBox="0 0 32 30" role="img" aria-label="Central heat plant boiler icon" shape-rendering="crispEdges"><use href="#source-icon-plant"/></svg><b>CENTRAL PLANT</b><strong>${fmt(node.inletTempC)} °C</strong><small>RETURN RECEIVED</small></div>`;
    const source = node.type === "WASTE_HEAT_SOURCE";
    const consumer = node.type === "THREE_PIPE_CONSUMER";
    const icon = source && node.id === "SM-1"
      ? `<svg class="source-icon supermarket-icon return-node-icon" viewBox="0 0 32 30" role="img" aria-label="Supermarket refrigeration heat icon" shape-rendering="crispEdges"><use href="#source-icon-supermarket"/></svg>`
      : `<span class="return-node-icon">${source ? "＋" : consumer ? "−" : "↙"}</span>`;
    const status = source ? node.enabled === false ? "DISABLED" : node.dispatchedKW > 0 ? "INJECTING" : "UNUSED SOURCE HEAT"
      : consumer ? node.allocatedKW >= node.demandKW && node.demandKW > 0 ? "RETURN HEAT ONLY"
        : node.allocatedKW > 0 ? "RETURN + SUPPLY TOP-UP" : "SUPPLY TOP-UP ONLY" : "ORDINARY RETURN FLOW";
    const power = source ? `+${fmt(node.dispatchedKW ?? 0)} kW INJECTION` : consumer ? `RETURN HEAT ${fmt(node.allocatedKW ?? 0)} kW` : "";
    const temperatureLine = source ? `SOURCE ${fmt(node.sourceTempC)} °C · ${fmt((node.availableKW ?? 0) / 1000, 2)} MW AVAILABLE`
      : consumer ? `DEMAND ${fmt(node.demandKW)} kW · MIN ${fmt(node.minimumUsableTempC)} °C` : "ORDINARY RETURN FLOW";
    let eligibility = "";
    if (consumer) {
      const downstream = state.sources.filter(candidate => Number(candidate.order) > Number(node.order));
      const upstream = state.sources.filter(candidate => isReturnSourceAvailableToConsumer(candidate, node));
      if (!upstream.length && downstream.length) eligibility = "SOURCE DOWNSTREAM — NOT AVAILABLE";
      else if (upstream.length && !upstream.some(candidate => Number(candidate.sourceTempC) >= Number(node.minimumUsableTempC))) eligibility = "UPSTREAM SOURCE TEMPERATURE TOO LOW";
      else if (!upstream.length) eligibility = "NO UPSTREAM SOURCE";
    }
    const showWhy = document.body.dataset.mode === "demo" && (source || consumer);
    const maxShare = consumer ? `${fmt(node.maxReturnShare ?? 100, 0)}% MAX SHARE` : "";
    const actualShare = consumer && node.demandKW > 0 ? `${fmt((node.allocatedKW / node.demandKW) * 100, 0)}% ACTUAL` : "";
    const supplyTopUp = consumer ? `SUPPLY TOP-UP ${fmt(node.supplyTopUpKW ?? Math.max(0, node.demandKW - node.allocatedKW))} kW` : "";
    const stateLabel = consumer ? node.eligibilityStatus ?? node.status : "";
    const ordinaryBranch = node.type === "RETURN_BRANCH";
    return `<div class="return-node ${source ? "injection-node" : consumer ? "extraction-node" : "ordinary-return-node"}${ordinaryBranch ? " two-pipe-return-node" : ""}${node.id === "SM-1" ? " supermarket-return-node" : ""}" ${source || consumer ? `data-return-object="${source ? node.id === "SM-1" ? "supermarket" : "source" : "pip3"}" data-node-id="${node.id}" tabindex="0" role="button"` : ""}>${icon}<b>${escapeHtml(node.name).toUpperCase()}</b><strong>${fmt(node.inletTempC)} °C <i>←</i> ${fmt(node.outletTempC)} °C</strong><small>${temperatureLine}</small><small>${power}</small>${consumer ? `<small>${maxShare} · ${actualShare}</small><small>${supplyTopUp}</small>` : ""}<em>${status}</em>${eligibility ? `<small class="topology-warning">${eligibility}</small>` : ""}${stateLabel ? `<small class="return-eligibility-state">${stateLabel}</small>` : ordinaryBranch ? "<small>TWO-PIPE · SUPPLY ONLY</small>" : ""}<small class="engineer-only">ORDER ${fmt(node.order, 0)} · FLOW ${fmt(node.returnFlowM3h ?? state.returnFlowM3h, 0)} m³/h</small>${showWhy ? `<button type="button" class="network-why-button" data-inspect-kind="${source ? node.id === "SM-1" ? "supermarket" : "source" : "pip3"}" data-i18n="interaction.why">WHY?</button>` : ""}</div>`;
  }).join(`<span class="return-flow-arrow" aria-hidden="true">←</span>`);
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

function returnTopologySequence(state) {
  return state.nodes.filter(node => node.id !== "SM-1" && node.id !== "PLANT"
    && (node.type === "THREE_PIPE_CONSUMER" || node.type === "RETURN_BRANCH"
      || node.type === "WASTE_HEAT_SOURCE" && node.enabled !== false))
    .sort((a, b) => Number(b.order) - Number(a.order) || String(a.id).localeCompare(String(b.id)));
}

function renderReturnTopologyEditor(state) {
  const host = $("return-topology-editor");
  const sourceNode = $("full-sm-node");
  const sourcePipe = $("full-sm-pipe");
  const supermarket = state.nodes.find(node => node.id === "SM-1");
  const sequence = returnTopologySequence(state);
  const slot = sequence.filter(node => Number(node.order) > Number(supermarket?.order)).length;
  host.classList.toggle("editing-return-topology", supermarketTopologySelected);
  host.innerHTML = `<div class="return-topology-title"><b>${escapeHtml(translate("return.flow_to_plant"))}</b><small>${escapeHtml(translate(supermarketTopologySelected ? "return.move_supermarket" : "return.select_supermarket"))}</small></div><div class="return-topology-track" role="list" aria-label="${escapeHtml(translate("return.flow_to_plant"))}"></div>`;
  const track = host.querySelector(".return-topology-track");
  const plant = document.createElement("span");
  plant.className = "return-topology-node return-topology-plant"; plant.setAttribute("role", "listitem"); plant.textContent = translate("return.central_plant"); track.append(plant);
  for (let index = 0; index <= sequence.length; index++) {
    const target = document.createElement("button");
    target.type = "button"; target.className = "return-snap-target"; target.dataset.returnSlot = String(index);
    target.setAttribute("aria-label", index < sequence.length ? translate("return.before_node", { node: sequence[index].name }) : translate("return.after_last"));
    target.textContent = index < sequence.length ? translate("return.before_node", { node: sequence[index].name.toUpperCase() }) : translate("return.after_last");
    if (index === slot) {
      sourceNode.classList.toggle("selected", supermarketTopologySelected);
      sourceNode.setAttribute("aria-pressed", String(supermarketTopologySelected));
      sourceNode.dataset.returnObject = "supermarket-topology";
      track.append(sourceNode);
    }
    track.append(target);
    if (index < sequence.length) {
      const node = sequence[index];
      const chip = document.createElement("span");
      chip.className = `return-topology-node${node.type === "WASTE_HEAT_SOURCE" ? " return-topology-source" : node.type === "THREE_PIPE_CONSUMER" ? " return-topology-pip3" : ""}`;
      chip.setAttribute("role", "listitem");
      chip.textContent = node.type === "WASTE_HEAT_SOURCE" ? translate("return.data_center_raw") : node.type === "THREE_PIPE_CONSUMER" ? translate("return.branch_pip3", { branch: node.id }) : translate("return.branch_two_pipe", { branch: node.id });
      track.append(chip);
    }
  }
  host.append(sourcePipe);
  const updateSourcePipePosition = () => {
    if (typeof sourceNode.getBoundingClientRect !== "function") return;
    const sourceRect = sourceNode.getBoundingClientRect();
    const mainRect = document.querySelector(".full-return-spine").getBoundingClientRect();
    const hostRect = host.getBoundingClientRect();
    const left = sourceRect.left + sourceRect.width / 2 - hostRect.left - host.clientLeft;
    const top = mainRect.bottom - hostRect.top - host.clientTop - 1;
    const height = Math.max(0, sourceRect.top - mainRect.bottom + 2);
    sourcePipe.setAttribute("style", `left:${left}px;top:${top}px;height:${height}px`);
  };
  track.addEventListener("scroll", updateSourcePipePosition, { passive: true });
  if (typeof ResizeObserver !== "undefined") {
    host.supermarketPipeObserver ??= new ResizeObserver(updateSourcePipePosition);
    host.supermarketPipeObserver.observe(host);
  }
  updateSourcePipePosition();
}

function moveSupermarketToSlot(slotIndex) {
  if (!latestNetworkState || document.body.dataset.mode !== "engineer") return;
  const sequence = returnTopologySequence(latestNetworkState.returnNetwork);
  const index = Math.max(0, Math.min(sequence.length, Number(slotIndex) || 0));
  const left = sequence[index - 1];
  const right = sequence[index];
  const order = left && right ? (Number(left.order) + Number(right.order)) / 2
    : right ? Number(right.order) + 10 : left ? Number(left.order) - 10 : 15;
  $("sm-order").value = String(order);
  supermarketTopologySelected = false;
  recalculate();
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
  const industrial = after.industrialWasteHeat;
  $("full-industrial-temp").textContent = `${fmtTemp(industrial.sourceTempC)} °C SOURCE`;
  $("full-industrial-contribution").textContent = `${fmtTemp(industrial.contributionTemp)} °C AT HMP · −${fmt(industrial.lossToHMP)} K LOSS`;
  $("full-industrial-allocation").textContent = `${fmt(industrial.availableKW / 1000, 2)} MW AVAILABLE · ${fmt(industrial.injectedKW / 1000, 2)} MW USED`;
  $("full-industrial-status").textContent = industrial.status === "TEMPERATURE BLOCKED" ? translate("industry.temperature_blocked")
    : industrial.status === "INJECTING" ? translate("industry.injecting")
      : industrial.status === "UNAVAILABLE" ? translate("industry.unavailable") : translate("industry.available_idle");
  const wastewater = after.wastewaterHeat;
  $("full-wastewater-temp").textContent = `${fmt(wastewater.sourceTempC)} °C DELIVERED`;
  $("full-wastewater-contribution").textContent = `${fmt(wastewater.contributionTemp)} °C AT HMP · −${fmt(wastewater.lossToHMP)} K`;
  $("full-wastewater-power").textContent = `${fmt(wastewater.availableKW / 1000, 2)} MW AVAILABLE · ${fmt(wastewater.injectedKW / 1000, 2)} MW USED`;
  $("full-wastewater-status").textContent = translate(wastewater.status === "TEMPERATURE BLOCKED" ? "industry.temperature_blocked"
    : wastewater.status === "INJECTING" ? "industry.injecting" : wastewater.status === "UNAVAILABLE" ? "industry.unavailable" : "industry.available_idle");
  const sinks = after.flexibleSinks;
  const greenhouseRoute = sinks.greenhouse.returnHeatKW > 0 ? translate("flex.return") : sinks.greenhouse.supplyHeatKW > 0 ? translate("flex.supply") : "NO CONNECTION";
  const greenhouseMode = sinks.greenhouse.connectionMode === "auto" ? translate("flex.auto") : translate(`flex.${sinks.greenhouse.connectionMode}`);
  $("full-greenhouse-mode").textContent = `${greenhouseMode} · ${greenhouseRoute}`;
  $("full-greenhouse-heat").textContent = `${fmt(sinks.greenhouse.totalHeatKW / 1000, 2)} MWth`;
  $("full-greenhouse-status").textContent = sinks.greenhouse.status === "USING HEAT" ? translate("flex.using_heat")
    : sinks.greenhouse.status === "DISABLED" ? "DISABLED" : translate("flex.no_surplus");
  $("full-absorption-status").textContent = sinks.absorptionCooling.status === "USING HEAT" ? translate("flex.using_heat")
    : sinks.absorptionCooling.status === "TEMPERATURE LIMITED" ? translate("flex.temperature_limited")
      : sinks.absorptionCooling.status === "DISABLED" ? "DISABLED" : translate("flex.no_surplus");
  $("full-absorption-heat").textContent = `${fmt(sinks.absorptionCooling.heatInputKW / 1000, 2)} MWth INPUT`;
  $("full-cooling-output").textContent = `${fmt(sinks.absorptionCooling.coolingOutputKW / 1000, 2)} MW COOLING OUTPUT`;
  $("full-sm-temp").textContent = `${fmt(Number(supermarket?.sourceTempC))} °C`;
  $("full-sm-power").textContent = `+${fmt((supermarket?.dispatchedKW ?? 0) / 1000, 2)} MW`;
  $("full-sm-status").textContent = supermarket?.dispatchedKW > 0 ? "RETURN ONLY" : supermarket?.enabled === false ? "OFF" : "IDLE";
  $("full-return-to-plant").textContent = `${fmt(state.returnTempAtPlantC)} °C`;
  $("full-supply-main-temp").textContent = `${fmt(after.hmpTemperatureCapabilityTemp)} °C`;
  $("full-return-main-label").textContent = `RETURN MAIN · ${fmt(state.returnTempBeforeRecoveryC)} °C BEFORE RECOVERY`;
  $("full-return-temperature-layer").textContent = `RETURN TO PLANT · ${fmt(state.returnTempAtPlantC)} °C`;
  $("full-plant-node").classList.toggle("plant-inactive", !plantActive);
  $("full-plant-pipe").classList.toggle("pipe-inactive", !plantActive);
  $("full-dc-node").classList.toggle("source-inactive", !dcActive && after.wasteHeat.mode !== "raw-return");
  $("full-dc-pipe").classList.toggle("pipe-inactive", !dcActive);
  $("full-dc-return-pipe").classList.toggle("pipe-inactive", after.wasteHeat.mode !== "raw-return");
  $("full-industrial-node").classList.toggle("source-inactive", industrial.injectedKW <= 0);
  $("full-industrial-pipe").classList.toggle("pipe-inactive", industrial.injectedKW <= 0);
  $("full-wastewater-node").classList.toggle("source-inactive", wastewater.injectedKW <= 0);
  $("full-wastewater-pipe").classList.toggle("pipe-inactive", wastewater.injectedKW <= 0);
  $("full-dc-return-label").classList.toggle("source-inactive", !dcReturnActive);
  $("full-sm-node").classList.toggle("source-inactive", !supermarket || supermarket.dispatchedKW <= 0);
  $("full-sm-pipe").classList.toggle("pipe-inactive", !supermarket || supermarket.dispatchedKW <= 0);
  $("full-hmp-node").classList.toggle("hmp-deficit", !hmpActive);

  $("full-branch-layer").innerHTML = after.afterBranches.map(branch => {
    const consumer = consumers.get(branch.id);
    const pip3Customer = Boolean(consumer);
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
  renderReturnTopologyEditor(state);
}

function updateHmpSourceFeederGeometry() {
  const feeders = [
    ["wastewater-feed-pipe", "wastewater-node", "hmp-node", 0.25, "left"],
    ["plant-feed-pipe", "plant-node", "hmp-node", 0.72, "left"],
    ["dc-feed-pipe", "dc-node", "hmp-node", 0.32, "right"],
    ["industrial-feed-pipe", "industrial-node", "hmp-node", 0.72, "right"],
    ["full-wastewater-pipe", "full-wastewater-node", "full-hmp-node", 0.25, "left"],
    ["full-plant-pipe", "full-plant-node", "full-hmp-node", 0.72, "left"],
    ["full-dc-pipe", "full-dc-node", "full-hmp-node", 0.32, "right"],
    ["full-industrial-pipe", "full-industrial-node", "full-hmp-node", 0.72, "right"]
  ];
  for (const [pipeId, sourceId, hmpId, anchorRatio, side] of feeders) {
    const pipe = $(pipeId), source = $(sourceId), hmp = $(hmpId), arm = pipe?.parentElement;
    if (!pipe || !source || !hmp || !arm || typeof arm.getBoundingClientRect !== "function") continue;
    if (side === "left" && !arm.querySelector(".source-feeder-elbow")) {
      const elbow = document.createElement("i");
      elbow.className = "source-feeder-elbow";
      elbow.setAttribute("aria-hidden", "true");
      arm.append(elbow);
    }
    const armRect = arm.getBoundingClientRect(), sourceRect = source.getBoundingClientRect(), hmpRect = hmp.getBoundingClientRect();
    if (!armRect.width || !hmpRect.width || !hmpRect.height) continue;
    const sourceCenterY = sourceRect.top + sourceRect.height / 2;
    const anchorY = hmpRect.top + hmpRect.height * anchorRatio;
    const sourceLeft = sourceRect.left - armRect.left;
    const sourceRight = sourceRect.right - armRect.left;
    arm.setAttribute("style", `--hmp-feeder-y:${anchorY - armRect.top}px;--feeder-source-left:${sourceLeft}px;--feeder-source-right:${sourceRight}px;--feeder-elbow-top:${Math.min(sourceCenterY, anchorY) - armRect.top}px;--feeder-elbow-height:${Math.abs(sourceCenterY - anchorY)}px`);
  }
}

function updateNetworkView() {
  const mode = $("network-view-selector").value;
  $("supply-network-view").hidden = mode !== "supply";
  $("return-network-view").hidden = mode !== "return";
  $("full-system-view").hidden = mode !== "full";
  $("network-map").dataset.view = mode;
  updateHmpSourceFeederGeometry();
}

if (typeof window.addEventListener === "function") window.addEventListener("resize", updateHmpSourceFeederGeometry, { passive: true });
if (typeof ResizeObserver !== "undefined") {
  const hmpFeederObserver = new ResizeObserver(updateHmpSourceFeederGeometry);
  for (const id of ["hmp-node", "plant-node", "dc-node", "industrial-node", "wastewater-node", "full-hmp-node", "full-plant-node", "full-dc-node", "full-industrial-node", "full-wastewater-node"]) {
    const node = $(id);
    if (node) hmpFeederObserver.observe(node);
  }
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
  set("map-hmp-temp", document.body.dataset.mode === "casual" ? `${fmt(after.hmpTemperatureCapabilityTemp)} °C` : `${fmt(after.hmpTemperatureCapabilityTemp)} °C ${after.sourceBlending?.selected ? "BLENDED ESTIMATE" : "CAPABILITY"}`);
  set("map-hmp-method-note", after.sourceBlending?.selected ? "SIMPLIFIED MIXING ESTIMATE · NOT HYDRAULIC" : "TEMPERATURE CAPABILITY · NOT A MIXED HMP RESULT");
  set("map-hmp-target", document.body.dataset.mode === "casual" ? `GRID ${fmt(after.hmpTargetTemp)} °C` : `TARGET ${fmt(after.hmpTargetTemp)} °C`);
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
  set("map-main-temp", document.body.dataset.mode === "casual" ? `GRID ${fmt(after.hmpTargetTemp)} °C` : `${fmt(after.hmpTemperatureCapabilityTemp)} °C ${after.sourceBlending?.selected ? "SIMPLIFIED MIXING ESTIMATE" : "CAPABILITY"} · TARGET ${fmt(after.hmpTargetTemp)} °C`);
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
  const industrial = after.industrialWasteHeat;
  set("map-industrial-temp", `${fmtTemp(industrial.sourceTempC)} °C SOURCE`);
  set("map-industrial-contribution", `${fmtTemp(industrial.contributionTemp)} °C AT HMP`);
  set("map-industrial-power", `${fmt(industrial.availableKW)} kWth available · ${fmt(industrial.injectedKW)} kWth used`);
  set("map-industrial-loss", `−${fmt(industrial.lossToHMP)} K LOSS`);
  set("map-industrial-status", industrial.status === "TEMPERATURE BLOCKED" ? `⛔ ${translate("industry.temperature_blocked")}`
    : industrial.status === "INJECTING" ? `▶ ${translate("industry.injecting")} · ${fmt(industrial.injectedKW)} kWth`
      : industrial.status === "UNAVAILABLE" ? `○ ${translate("industry.unavailable")}` : `○ ${translate("industry.available_idle")}`);
  $("map-industrial-status").className = `mini-status ${industrial.status === "INJECTING" ? "eligible" : industrial.status === "TEMPERATURE BLOCKED" ? "ineligible" : ""}`;
  $("industrial-feed-pipe").classList.toggle("pipe-blocked", industrial.injectedKW <= 0);
  $("hmp-node").classList.toggle("hmp-deficit", !temperatureReachable);
  $("hmp-node").classList.toggle("hmp-capacity-limited", temperatureReachable && capacityShortfall);
  renderBranches(after);
  renderReturnHeat(result);
  renderFullSystem(result, input);
  updateNetworkView();
  renderBoosterTray();
  renderCasualResults(result, input);
  renderSystemSummary(result, input);
  renderProfile(after); renderBranchComparison(after); renderEnergy(after); renderDataCenterModes(result); renderComparison(result, result.comparison);
  if (document.body.dataset.mode === "demo") renderGuidedDemo(input, latestNetworkState);
}

function renderCasualResults(result, input) {
  if (document.body.dataset.mode !== "casual") return;
  const currentMetrics = summarizeNetworkFlexState(result, input, flexPrices());
  const baseline = casualBaseline ?? { input, prices: flexPrices() };
  const baselineResult = simulateNetwork(baseline.input, baseline.prices);
  const before = baselineResult.withBooster;
  const current = result.withBooster;
  const beforeMetrics = summarizeNetworkFlexState(baselineResult, baseline.input, baseline.prices);
  const signed = value => `${value > 0 ? "+" : ""}${fmt(value)}`;
  set("casual-grid-temp", `${fmtTemp(before.hmpTargetTemp)} °C → ${fmtTemp(current.hmpTargetTemp)} °C`);
  set("casual-heat-used", `${fmt(before.totalWasteHeatUsedKW / 1000)} → ${fmt(current.totalWasteHeatUsedKW / 1000)} MW`);
  set("casual-central-reduced", `${signed((before.centralPlantUsedKW - current.centralPlantUsedKW) / 1000)} MW`);
  set("casual-booster-electricity", `${signed(current.booster.electricalPowerKW - before.booster.electricalPowerKW)} kW`);
  set("casual-operating-impact", `${signed(currentMetrics.operatingCostPerHour - beforeMetrics.operatingCostPerHour)} €/h`);
  set("casual-operating-cost", `${translate("casual.operating_cost")}: ${fmt(currentMetrics.operatingCostPerHour, 2)} €/h`);
  const rawAvailableKW = Number(input.wasteHeat.maxPowerMW) * 1000 * Number(input.wasteHeat.availabilityPercent) / 100;
  set("casual-source-facts", translate("casual.source_facts", { temperature: fmtTemp(input.wasteHeat.injectionTemp), power: fmt(rawAvailableKW / 1000) }));
  const industrial = current.industrialWasteHeat;
  const industrialStatus = industrial.status === "INJECTING" ? translate("industry.injecting")
    : industrial.status === "TEMPERATURE BLOCKED" ? translate("industry.temperature_blocked")
      : industrial.status === "UNAVAILABLE" ? translate("industry.unavailable") : translate("industry.available_idle");
  $("casual-industrial-facts").textContent = translate("industry.casual_facts", {
    name: translate("industry.name"), temperature: fmtTemp(industrial.sourceTempC), power: fmt(industrial.availableKW / 1000), status: industrialStatus
  });
  for (const button of [$("casual-source-raw"), $("casual-source-upgraded"), $("casual-source-high-temp")]) {
    const active = button.dataset.casualSource === input.wasteHeat.mode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  const title = $("opportunity-title");
  if (title) title.textContent = translate("casual.system_result");
  const kicker = $("opportunity-kicker");
  if (kicker) kicker.textContent = translate("casual.unlock");
}

function recalculate() {
  const warning = $("network-validation");
  try {
    const input = readScenario(), prices = flexPrices();
    const modelInput = document.body.dataset.mode === "demo"
      ? { ...input, industrialWasteHeat: { ...input.industrialWasteHeat, availableThermalKW: 0 },
        wastewaterHeat: { ...input.wastewaterHeat, enabled: false }, flexibleSinks: { greenhouse: { enabled: false }, absorptionCooling: { enabled: false } } } : input;
    const result = simulateNetwork(modelInput, prices);
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
  const pip3 = scenario.pip3 ?? {};
  const branchOrders = { A: 70, B: 60, C: 50, D: 40, E: 30, F: 20,
    ...Object.fromEntries(Object.entries(pip3).map(([id, settings]) => [id, settings.order])) };
  const returnDefaults = { "return-base-temp": scenario.networkReturnTemp ?? 45, "return-flow": scenario.returnFlowM3h ?? 50,
    "sm-enabled": scenario.supermarketEnabled ? "true" : "false", "sm-temp": scenario.supermarketSourceTempC ?? 48,
    "sm-power": scenario.supermarketPowerKW ?? 350, "sm-max-injection": scenario.supermarketPowerKW ?? 350,
    "dc-return-order": scenario.dcReturnOrder ?? 10, "sm-order": scenario.smOrder ?? 15,
    ...Object.fromEntries(Object.entries(branchOrders).map(([id, order]) => [`pip3-${id.toLowerCase()}-order`, order])) };
  for (const [id, value] of Object.entries(returnDefaults)) $(id).value = String(value);
  const wastewater = scenario.wastewaterHeat ?? { enabled: true, sourceTempC: scenario.wastewaterTemp ?? 80,
    availableThermalKW: (scenario.wastewaterPower ?? 2.5) * 1000, availabilityPercent: scenario.wastewaterAvailability ?? 100, lossToHMP: scenario.wastewaterLoss ?? 1 };
  const sinks = scenario.flexibleSinks ?? { greenhouse: scenario.greenhouse ?? { enabled: false }, absorptionCooling: scenario.absorptionCooling ?? { enabled: false } };
  for (const [id, value] of Object.entries({
    "wastewater-enabled": wastewater.enabled, "wastewater-temp": wastewater.sourceTempC,
    "wastewater-power": Number(wastewater.availableThermalKW) / 1000, "wastewater-availability": wastewater.availabilityPercent,
    "wastewater-loss": wastewater.lossToHMP, "greenhouse-enabled": sinks.greenhouse?.enabled,
    "greenhouse-demand": Number(sinks.greenhouse?.maxDemandKW ?? 2500) / 1000,
    "greenhouse-min-temp": sinks.greenhouse?.minimumTemperatureC ?? 50, "greenhouse-mode": sinks.greenhouse?.connectionMode ?? "auto",
    "absorption-enabled": sinks.absorptionCooling?.enabled, "absorption-capacity": Number(sinks.absorptionCooling?.maxHeatInputKW ?? 2000) / 1000,
    "absorption-min-temp": sinks.absorptionCooling?.minimumDrivingTempC ?? 80, "absorption-cop": sinks.absorptionCooling?.thermalCOP ?? 0.7
  })) $(id).value = String(value ?? "false");
  $("network-view-selector").value = document.body.dataset.mode === "casual" ? "supply" : scenario.returnHeatDemo ? "full" : "supply";
  $("network-return-temp").value = scenario.networkReturnTemp ?? 40;
  $("network-reference-delta").value = scenario.referenceNetworkDeltaK ?? "";
  $("source-temperature-strategy").value = "strict";
  $("normal-plant-supply").value = scenario.plantTemp;
  $("max-ramped-plant-supply").value = Number(scenario.plantTemp) + 15;
  for (const [id, key] of [["hmp-target", "hmp"], ["outdoor-temp", "outdoor"], ["plant-temp", "plantTemp"], ["plant-power", "plantPower"], ["plant-availability", "plantAvailability"], ["plant-loss", "plantLoss"], ["dc-mode", "dcMode"], ["dc-temp", "dcTemp"], ["dc-power", "dcPower"], ["dc-availability", "dcAvailability"], ["dc-loss", "dcLoss"], ["industrial-temp", "industrialTemp"], ["industrial-power", "industrialPower"], ["industrial-availability", "industrialAvailability"], ["industrial-loss", "industrialLoss"], ["booster-branch", "branch"], ["booster-mode", "mode"], ["booster-setpoint", "setpoint"], ["network-cop", "cop"], ["booster-capacity", "capacity"], ["dc-single-temp", "singleTemp"], ["dc-single-cop", "singleCOP"], ["dc-stage1-temp", "stage1Temp"], ["dc-stage1-cop", "stage1COP"], ["dc-stage2-temp", "stage2Temp"], ["dc-stage2-cop", "stage2COP"]]) $(id).value = String(scenario[key]);
  $("dc-return-max-injection").value = scenario.dcMode === "raw-return" ? scenario.dcPower * 1000 : 0;
  for (const item of branchControls.querySelectorAll("input")) {
    const branch = branchDefaults.find(b => b.id === item.dataset.branch);
    if (!branch) continue;
    const branchPip3 = pip3[branch.id];
    const branchProfile = scenario.branchProfile?.[branch.id] ?? {};
    if (item.dataset.key === "pip3Enabled") item.checked = Boolean(branchPip3);
    else if (item.dataset.key === "maxReturnShare") item.value = String(branchPip3?.maxReturnShare ?? ({ A: 30, B: 55, C: 40, D: 70, E: 100, F: 80 })[branch.id]);
    else if (item.dataset.key === "minimumUsableTempC") item.value = String(branchPip3?.minimumUsableTempC ?? 45);
    else if (item.dataset.key === "name") item.value = branchName(branch);
    else item.value = String(branchProfile[item.dataset.key] ?? branch[item.dataset.key] ?? "");
  }
  gridBoosters = scenario.gridBoosters.map(item => ({ ...item }));
  nextBoosterId = Math.max(1, ...gridBoosters.map(item => {
    const match = String(item.id).match(/^GB-(\d+)$/);
    return match ? Number(match[1]) + 1 : 1;
  }));
  $("comparison-temp-input").value = scenario.hmp;
  $("scenario-description").textContent = scenario.description;
  $("scenario-purpose").textContent = translate(scenario.purpose);
  $("scenario-try-list").innerHTML = scenario.whatToTry.map((key, index) => `<li><span>${index + 1}.</span> ${escapeHtml(translate(key))}</li>`).join("");
  casualBaseline = { input: JSON.parse(JSON.stringify(readScenario())), prices: { ...flexPrices() } };
  selectedCasualBoosterId = "";
  updatePip3Controls();
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
  const snap = event.target.closest?.("[data-return-slot]");
  if (snap) { moveSupermarketToSlot(snap.dataset.returnSlot); return; }
  const supermarketNode = event.target.closest?.("#full-sm-node");
  if (supermarketNode && document.body.dataset.mode === "engineer") {
    supermarketTopologySelected = !supermarketTopologySelected;
    renderReturnTopologyEditor(latestNetworkState.returnNetwork);
    return;
  }
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
$("network-map").addEventListener("dragstart", event => {
  if (!event.target.closest?.("#full-sm-node") || document.body.dataset.mode !== "engineer") return;
  event.dataTransfer?.setData("text/plain", "SM-1");
  event.target.closest("#full-sm-node").classList.add("dragging");
  $("return-topology-editor").classList.add("editing-return-topology");
});
$("network-map").addEventListener("dragend", event => {
  event.target.closest?.("#full-sm-node")?.classList.remove("dragging");
  $("return-topology-editor").classList.toggle("editing-return-topology", supermarketTopologySelected);
});
$("network-map").addEventListener("dragover", event => {
  if (event.target.closest?.("[data-return-slot]") && document.body.dataset.mode === "engineer") event.preventDefault();
});
$("network-map").addEventListener("drop", event => {
  const target = event.target.closest?.("[data-return-slot]");
  if (!target || event.dataTransfer?.getData("text/plain") !== "SM-1") return;
  event.preventDefault(); moveSupermarketToSlot(target.dataset.returnSlot);
});
$("network-map").addEventListener("keydown", event => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const customer = event.target.closest?.(".full-customer-column[data-branch]");
  const returnObject = event.target.closest?.("[data-return-object]");
  if (event.target.closest?.("#full-sm-node") && document.body.dataset.mode === "engineer") {
    event.preventDefault(); supermarketTopologySelected = !supermarketTopologySelected; renderReturnTopologyEditor(latestNetworkState.returnNetwork); return;
  }
  if (customer) { event.preventDefault(); selectedPip3Branch = customer.dataset.branch; selectedNetworkBranch = customer.dataset.branch; recalculate(); }
  if (returnObject) { event.preventDefault(); if (returnObject.dataset.returnObject === "pip3") selectedPip3Branch = returnObject.dataset.nodeId; if (document.body.dataset.mode === "demo") inspectObject(returnObject.dataset.returnObject); }
});
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
$("hmp-chart-metric").addEventListener("change", () => {
  const selected = $("hmp-chart-metric").value;
  for (const panel of document.querySelectorAll("[data-hmp-chart]")) panel.hidden = panel.dataset.hmpChart !== selected;
});
$("hmp-target").addEventListener("input", () => {
  const value = Number($("hmp-target").value);
  if (value >= 70 && value <= 95) $("hmp-target-slider").value = String(value);
  recalculate();
});
for (const id of ["outdoor-temp", "network-return-temp", "network-reference-delta", "plant-temp", "plant-power", "plant-availability", "plant-loss", "dc-temp", "dc-power", "dc-return-max-injection", "dc-availability", "dc-loss", "industrial-temp", "industrial-power", "industrial-availability", "industrial-loss", "wastewater-temp", "wastewater-power", "wastewater-availability", "wastewater-loss", "greenhouse-demand", "greenhouse-min-temp", "absorption-capacity", "absorption-min-temp", "absorption-cop", "dc-mode", "dc-single-temp", "dc-single-cop", "dc-stage1-temp", "dc-stage1-cop", "dc-stage2-temp", "dc-stage2-cop", "booster-branch", "booster-setpoint", "network-cop", "booster-capacity", "source-temperature-strategy", "normal-plant-supply", "max-ramped-plant-supply", "plant-ramp-cost"]) $(id).addEventListener("input", recalculate);
for (const id of ["wastewater-enabled", "greenhouse-enabled", "greenhouse-mode", "absorption-enabled"]) {
  $(id).addEventListener("input", recalculate);
  $(id).addEventListener("change", recalculate);
}
for (const id of ["sm-enabled", "return-base-temp", "return-flow", "sm-temp", "sm-power", "sm-max-injection", "dc-return-order", "sm-order", ...["a", "b", "c", "d", "e", "f"].map(id => `pip3-${id}-order`)]) $(id).addEventListener("input", recalculate);
$("network-view-selector").addEventListener("change", updateNetworkView);
for (const [id, mode] of [["casual-source-raw", "raw-return"], ["casual-source-upgraded", "one-stage"], ["casual-source-high-temp", "two-stage"]]) $(id).addEventListener("click", () => {
  $("dc-mode").value = mode;
  $("network-dc-route").value = mode;
  if (mode === "raw-return" && Number($("dc-return-max-injection").value) === 0)
    $("dc-return-max-injection").value = Number($("dc-power").value) * 1000 * Number($("dc-availability").value) / 100;
  recalculate();
});
$("casual-reset").addEventListener("click", () => loadScenario(Number(scenarioSelect.value)));
for (const id of ["sweep-start", "sweep-end", "sweep-step", "electricity-price", "central-heat-cost", "waste-heat-cost", "industrial-heat-cost", "wastewater-heat-cost", "cooling-price"]) $(id).addEventListener("input", recalculate);
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
  if (casual) { addCasualBooster(); return; }
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

$("annual-profile-select").addEventListener("change", renderAnnualProfile);
$("annual-empty").addEventListener("click", () => {
  annualProfiles[annualProfileKey()] = createAnnualProfile(); markAnnualProfileChanged();
});
$("annual-demo").addEventListener("click", () => {
  annualProfiles[annualProfileKey()] = annualCreateDemoProfile(); markAnnualProfileChanged();
});
$("annual-duplicate").addEventListener("click", () => {
  annualProfiles.project = duplicateAnnualProfile(annualProfiles.baseline);
  $("annual-profile-select").value = "project"; markAnnualProfileChanged();
});
$("annual-add-current").addEventListener("click", () => {
  const profile = annualProfiles[annualProfileKey()];
  profile.bins.push(createOperatingBin({ id: "bin-" + annualBinSequence++, label: translate("annual.current_point"), hoursPerYear: 0,
    snapshot: { input: readScenario(), prices: flexPrices(), savedAt: null } }));
  markAnnualProfileChanged();
});
$("annual-add-bin").addEventListener("click", () => {
  annualProfiles[annualProfileKey()].bins.push(createOperatingBin({ id: "bin-" + annualBinSequence++, label: translate("annual.new_bin"), hoursPerYear: 0,
    snapshot: { input: readScenario(), prices: flexPrices(), savedAt: null } }));
  markAnnualProfileChanged();
});
$("annual-run").addEventListener("click", runAnnualAnalysis);
$("annual-chart-metric").addEventListener("change", renderAnnualChart);
$("annual-bin-rows").addEventListener("change", event => {
  const labelId = event.target.dataset.annualLabel;
  const hoursId = event.target.dataset.annualHours;
  if (!labelId && !hoursId) return;
  const id = labelId ?? hoursId;
  const bin = annualProfiles[annualProfileKey()].bins.find(item => item.id === id);
  if (!bin) return;
  annualProfiles[annualProfileKey()] = updateOperatingBin(annualProfiles[annualProfileKey()], id,
    labelId ? { label: event.target.value } : { hoursPerYear: event.target.value === "" ? "" : Number(event.target.value) });
  markAnnualProfileChanged();
});
$("annual-bin-rows").addEventListener("click", event => {
  const button = event.target.closest?.("[data-annual-action]");
  if (!button) return;
  const profile = annualProfiles[annualProfileKey()], id = button.dataset.bin;
  const bin = profile.bins.find(item => item.id === id);
  if (!bin) return;
  if (button.dataset.annualAction === "load") loadSnapshot(bin.snapshot);
  if (button.dataset.annualAction === "update") annualProfiles[annualProfileKey()] = updateOperatingBin(profile, id,
    { snapshot: { input: readScenario(), prices: flexPrices(), savedAt: null } });
  if (button.dataset.annualAction === "duplicate") profile.bins.push(createOperatingBin({ ...bin, id: "bin-" + annualBinSequence++, label: bin.label + " · " + translate("annual.copy_suffix") }));
  if (button.dataset.annualAction === "remove") profile.bins = profile.bins.filter(item => item.id !== id);
  if (button.dataset.annualAction !== "load") markAnnualProfileChanged();
});
for (const id of ["annual-capex", "annual-fixed-om", "annual-other-benefit", "annual-period", "annual-discount"])
  $(id).addEventListener("input", renderAnnualResults);

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
annualProfiles.baseline = annualCreateDemoProfile(readScenario(), flexPrices());
annualProfiles.project = duplicateAnnualProfile(annualProfiles.baseline);
annualProfiles.project.bins = annualProfiles.project.bins.map(bin => {
  const input = bin.snapshot.input;
  input.gridBoosters = input.branches.filter(branch => Number(input.hmpTargetTemp) - Number(branch.lossToBranch) < Number(branch.minimumSupplyTemp))
    .map(branch => ({ id: `GB-${branch.id}`, branchId: branch.id, mode: "target", targetTemp: Number(branch.minimumSupplyTemp), liftK: 0,
      cop: Number(input.booster.cop), maxThermalKW: Number(input.booster.maxThermalKW) }));
  return bin;
});
$("annual-profile-select").value = "baseline";
renderAnnualProfile();

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
  if (mode === "consult" && !consultUnlocked) return;
  const previousMode = document.body.dataset.mode;
  if (mode === "casual" && previousMode !== "casual") {
    casualPriorNetworkView = $("network-view-selector").value;
    $("network-view-selector").value = "supply";
    setCasualControls(true);
  } else if (previousMode === "casual" && mode !== "casual") {
    setCasualControls(false);
    $("network-view-selector").value = casualPriorNetworkView;
  }
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
  if (mode !== "casual") {
    const title = $("opportunity-title");
    if (title) title.textContent = translate("analysis.system_opportunity");
    const kicker = $("opportunity-kicker");
    if (kicker) kicker.textContent = translate("analysis.opportunity_kicker");
  }
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
try { window.sessionStorage?.removeItem("consultModeUnlocked"); } catch {}
let consultUnlocked = false;
$("mode-consult").hidden = !consultUnlocked;
$("mode-consult").parentElement?.classList.toggle("consult-unlocked", consultUnlocked);
$("consult-unlock-toast").hidden = true;
let hmpClickCount = 0;
let hmpClickResetTimer = null;
function showConsultUnlockToast() {
  const toast = $("consult-unlock-toast");
  toast.hidden = false;
  toast.classList.remove("is-leaving");
  toast.classList.add("is-visible");
  setTimeout(() => {
    toast.classList.remove("is-visible");
    toast.classList.add("is-leaving");
    setTimeout(() => {
      toast.hidden = true;
      toast.classList.remove("is-leaving");
    }, 260);
  }, 4200);
}
function unlockConsultMode() {
  if (consultUnlocked) return;
  consultUnlocked = true;
  $("mode-consult").hidden = false;
  $("mode-consult").parentElement?.classList.add("consult-unlocked");
  showConsultUnlockToast();
}
function countHmpClickTowardConsultUnlock() {
  if (consultUnlocked) return;
  if (hmpClickCount === 0) hmpClickResetTimer = setTimeout(() => { hmpClickCount = 0; hmpClickResetTimer = null; }, 3000);
  hmpClickCount += 1;
  if (hmpClickCount === 5) {
    clearTimeout(hmpClickResetTimer);
    hmpClickResetTimer = null;
    hmpClickCount = 0;
    unlockConsultMode();
  }
}
for (const id of ["hmp-node", "full-hmp-node"]) $(id).addEventListener("click", countHmpClickTowardConsultUnlock);
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
