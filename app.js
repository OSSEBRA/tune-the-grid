import { calculate, calculateTargetMode, solveBoostFlow, validateInputs } from "./calculator.js?v=20261023-2";

const examples = [
  { name: "Reference · 206 m³/h", totalFlow: 206, inletTemp: 78, targetTemp: 80, boostFlow: 64, boostOutlet: 85, cop: 3, sourceTemp: 20 },
  { name: "Cold grid · higher lift", totalFlow: 180, inletTemp: 72, targetTemp: 78, boostFlow: 72, boostOutlet: 87, cop: 2.8, sourceTemp: 12 },
  { name: "Shoulder season · modest lift", totalFlow: 240, inletTemp: 68, targetTemp: 70, boostFlow: 80, boostOutlet: 74, cop: 4, sourceTemp: 25 }
];

function requiredElement(id) {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Required UI element #${id} is missing.`);
  return element;
}

const form = requiredElement("calc-form");
const caseSelect = requiredElement("case-select");
const modeDescription = requiredElement("mode-description");
const validation = requiredElement("validation");
const modeButtons = [...document.querySelectorAll(".mode-button")];
const fields = Object.fromEntries(["totalFlow", "inletTemp", "targetTemp", "boostFlow", "boostOutlet", "cop", "sourceTemp"].map(name => [name, form.elements[name]]));
const outputs = Object.fromEntries(["result-primary-label", "result-primary-value", "result-primary-unit", "result-title", "status-text", "status-badge", "target-reference", "thermal-result", "electric-result", "source-result", "bypass-result", "share-result", "lift-result", "schematic-inlet", "schematic-total", "schematic-boost-flow", "schematic-boost-out", "schematic-bypass", "schematic-mixed", "schematic-target", "chart-title"].map(id => [id, requiredElement(id)]));
let mode = "target";

const fmt = (value, digits = 1) => Number.isFinite(value) ? value.toLocaleString("en-GB", { maximumFractionDigits: digits, minimumFractionDigits: digits }) : "—";

for (const [index, item] of examples.entries()) {
  const option = document.createElement("option");
  option.value = String(index);
  option.textContent = item.name;
  caseSelect.append(option);
}

function readInput() {
  return Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, field.value]));
}

function displayError(errors) {
  validation.hidden = !errors.length;
  validation.replaceChildren();
  if (!errors.length) return;
  const strong = document.createElement("strong"); strong.textContent = "CHECK OPERATING POINT";
  const list = document.createElement("ul");
  for (const error of errors) { const li = document.createElement("li"); li.textContent = error; list.append(li); }
  validation.append(strong, list);
}

function setText(element, value) { element.textContent = value; }

function syncModeFields() {
  fields.targetTemp.required = mode !== "evaluate";
  fields.boostFlow.readOnly = mode === "flow";
  fields.boostOutlet.readOnly = mode === "target";
  fields.boostFlow.classList.toggle("calculated-input", mode === "flow");
  fields.boostOutlet.classList.toggle("calculated-input", mode === "target");
  requiredElement("target-field").classList.toggle("optional-field", mode === "evaluate");
  requiredElement("boost-flow-field").classList.toggle("calculated-field", mode === "flow");
  requiredElement("booster-outlet-field").classList.toggle("calculated-field", mode === "target");
  requiredElement("boost-flow-field").querySelector(".calculated-note").hidden = mode !== "flow";
  requiredElement("booster-outlet-field").querySelector(".calculated-note").hidden = mode !== "target";
  requiredElement("target-reference").hidden = mode === "evaluate" && !fields.targetTemp.value;
  modeDescription.textContent = mode === "target"
    ? "Set the target mixed supply and boosted partial flow. The required Gridbooster outlet and power are calculated."
    : mode === "flow"
      ? "Set the target mixed supply and available Gridbooster outlet. The required boosted partial flow and power are calculated."
      : "Set a known boosted partial flow and Gridbooster outlet. Target mixed supply is optional and used only as a reference.";
}

function drawOutletChart(inlet, target, currentShare, modeLabel) {
  const svg = requiredElement("outlet-chart"), ns = "http://www.w3.org/2000/svg";
  svg.replaceChildren();
  const el = (tag, attrs, content) => {
    const node = document.createElementNS(ns, tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    if (content != null) node.textContent = content;
    svg.append(node);
    return node;
  };
  el("title", { id: "outlet-chart-label" }, "Required Gridbooster outlet by boosted-flow share");
  const shareText = fmt(currentShare);
  const description = `For a ${fmt(inlet)} degree incoming network supply and ${fmt(target)} degree target mixed supply, required Gridbooster outlet falls as boosted-flow share rises. Current operating point is ${shareText} percent in ${modeLabel.toLowerCase()} mode.`;
  el("desc", { id: "outlet-chart-desc" }, description);

  const plot = { left: 68, top: 18, width: 650, height: 222 };
  const outletAt = share => inlet + (target - inlet) / (share / 100);
  const min = Math.min(inlet, target), max = outletAt(1);
  const pad = Math.max((max - min) * 0.06, 1), low = min - pad, high = max + pad;
  const x = share => plot.left + plot.width * share / 100;
  const y = temp => plot.top + plot.height * (high - temp) / (high - low);
  for (let i = 0; i <= 4; i++) {
    const gy = plot.top + plot.height * i / 4, temp = high - (high - low) * i / 4;
    el("line", { x1: plot.left, x2: plot.left + plot.width, y1: gy, y2: gy, class: "chart-grid" });
    el("text", { x: plot.left - 10, y: gy + 4, "text-anchor": "end", class: "chart-axis-label" }, `${fmt(temp, 0)}°`);
  }
  [0, 25, 50, 75, 100].forEach(share => {
    const gx = x(share);
    el("line", { x1: gx, x2: gx, y1: plot.top, y2: plot.top + plot.height, class: "chart-grid vertical" });
    el("text", { x: gx, y: plot.top + plot.height + 22, "text-anchor": "middle", class: "chart-axis-label" }, `${share}%`);
  });
  el("line", { x1: plot.left, x2: plot.left + plot.width, y1: y(target), y2: y(target), class: "chart-target-line" });
  const points = Array.from({ length: 100 }, (_, i) => `${x(i + 1)},${y(outletAt(i + 1))}`).join(" ");
  el("polyline", { points, class: "chart-curve" });
  const markerShare = Math.max(0, Math.min(100, currentShare));
  const markerY = y(markerShare === 0 ? high : outletAt(markerShare));
  el("line", { x1: x(markerShare), x2: x(markerShare), y1: plot.top, y2: plot.top + plot.height, class: "chart-current-line" });
  el("circle", { cx: x(markerShare), cy: markerY, r: 7, class: "chart-current-marker" });
  el("text", { x: plot.left + plot.width / 2, y: 291, "text-anchor": "middle", class: "chart-axis-title" }, "BOOSTED-FLOW SHARE OF TOTAL NETWORK FLOW");
  el("text", { x: 17, y: plot.top + plot.height / 2, "text-anchor": "middle", transform: `rotate(-90 17 ${plot.top + plot.height / 2})`, class: "chart-axis-title" }, "REQUIRED GRIDBOOSTER OUTLET (°C)");
}

function showInvalid(errors) {
  displayError(errors);
  requiredElement("target-chart-section").hidden = true;
  requiredElement("sizing-flow-grid").classList.add("single-flow-panel");
  outputs["result-title"].textContent = "Gridbooster sizing result";
  outputs["status-badge"].textContent = "CHECK";
  outputs["status-badge"].className = "status-badge warning";
  outputs["status-text"].textContent = "Correct the inputs to calculate";
  outputs["target-reference"].hidden = true;
  requiredElement("extreme-warning").hidden = true;
  setText(outputs["result-primary-value"], "—");
  setText(outputs["result-primary-unit"], "—");
  for (const id of ["thermal-result", "electric-result", "source-result", "bypass-result", "share-result", "lift-result", "schematic-inlet", "schematic-total", "schematic-boost-flow", "schematic-boost-out", "schematic-bypass", "schematic-mixed", "schematic-target"]) setText(outputs[id], "—");
}

function update() {
  syncModeFields();
  const input = readInput();
  let result, effectiveInput, primaryLabel, primaryValue, primaryUnit, status, statusClass = "", target = null;
  try {
    if (mode === "target") {
      result = calculateTargetMode(input);
      fields.boostOutlet.value = result.boostOutlet;
      effectiveInput = { ...input, boostOutlet: result.boostOutlet };
      target = Number(input.targetTemp);
      primaryLabel = "REQUIRED GRIDBOOSTER OUTLET"; primaryValue = result.boostOutlet; primaryUnit = "°C";
      status = "Outlet and thermal duty include bypass dilution";
    } else if (mode === "flow") {
      const solvedFlow = solveBoostFlow({ ...input, boostFlow: 0 }, Number(input.targetTemp));
      if (solvedFlow > Number(input.totalFlow)) throw new Error("Required boosted partial flow exceeds total network flow.");
      fields.boostFlow.value = solvedFlow;
      effectiveInput = { ...input, boostFlow: solvedFlow };
      result = calculate(effectiveInput);
      target = Number(input.targetTemp);
      primaryLabel = "REQUIRED BOOSTED PARTIAL FLOW"; primaryValue = solvedFlow; primaryUnit = "m³/h";
      status = "Flow solved from target mixed supply and selected outlet";
    } else {
      const errors = validateInputs(input);
      if (errors.length) throw new Error(errors.join(" "));
      effectiveInput = input;
      result = calculate(effectiveInput);
      if (input.targetTemp !== "") target = Number(input.targetTemp);
      primaryLabel = "MIXED SUPPLY TEMPERATURE"; primaryValue = result.mixedTemp; primaryUnit = "°C";
      status = target == null ? "Calculated from the current split and temperature lift" : `${fmt(result.mixedTemp - target, 2)} °C versus target mixed supply`;
    }
    displayError([]);
  } catch (error) {
    showInvalid([error.message]);
    return;
  }

  const inlet = Number(effectiveInput.inletTemp), total = Number(effectiveInput.totalFlow);
  const targetRelevant = target != null;
  if (targetRelevant) {
    const delta = result.mixedTemp - target;
    const reachable = target >= inlet && target <= Number(effectiveInput.boostOutlet);
    statusClass = !reachable ? "warning" : "";
    outputs["status-badge"].textContent = !reachable ? "TARGET UNREACHABLE" : Math.abs(delta) < 0.05 ? "ON TARGET" : "FEASIBLE";
    if (mode !== "target" && reachable) status = Math.abs(delta) < 0.05 ? "Mixed supply is within 0.05 °C of target" : `${fmt(Math.abs(delta), 2)} °C ${delta < 0 ? "below" : "above"} target mixed supply`;
    outputs["target-reference"].hidden = false;
  setText(outputs["target-reference"], `TARGET MIXED SUPPLY · ${fmt(target)} °C · RESULT ${fmt(result.mixedTemp)} °C · ${fmt(delta, 2)} K MARGIN`);
  } else {
    outputs["target-reference"].hidden = true;
    outputs["status-badge"].textContent = "CALCULATED";
  }
  outputs["status-badge"].className = `status-badge ${statusClass}`;
  outputs["result-title"].textContent = "Gridbooster sizing result";
  setText(outputs["status-text"], status);
  setText(outputs["result-primary-label"], primaryLabel);
  setText(outputs["result-primary-value"], fmt(primaryValue, 2));
  setText(outputs["result-primary-unit"], primaryUnit);
  setText(outputs["thermal-result"], fmt(result.thermalPower / 1000, 2));
  setText(outputs["electric-result"], fmt(result.electricPower));
  setText(outputs["source-result"], fmt(result.sourceHeat / 1000, 2));
  setText(outputs["bypass-result"], fmt(result.bypassFlow));
  setText(outputs["share-result"], fmt(result.boostedShare));
  setText(outputs["lift-result"], fmt(result.temperatureLift));

  const boosted = Number(effectiveInput.boostFlow), outlet = Number(effectiveInput.boostOutlet);
  setText(outputs["schematic-inlet"], `${fmt(inlet)}°C`);
  setText(outputs["schematic-total"], `${fmt(total)} m³/h`);
  setText(outputs["schematic-boost-flow"], `${fmt(boosted)} m³/h · ${fmt(inlet)} → ${fmt(outlet)} °C`);
  setText(outputs["schematic-boost-out"], `${fmt(outlet)}°C`);
  setText(outputs["schematic-bypass"], `${fmt(result.bypassFlow)} m³/h · ${fmt(inlet)}°C`);
  setText(outputs["schematic-mixed"], `${fmt(result.mixedTemp, 2)}°C`);
  setText(outputs["schematic-target"], targetRelevant ? `${fmt(target)}°C` : "REFERENCE OPTIONAL");
  requiredElement("schematic-target-line").hidden = !targetRelevant;
  requiredElement("schematic-target-line").hidden = !targetRelevant;

  const showChart = targetRelevant && mode !== "evaluate";
  requiredElement("target-chart-section").hidden = !showChart;
  requiredElement("sizing-flow-grid").classList.toggle("single-flow-panel", !showChart);
  if (showChart) {
    const modeLabel = mode === "target" ? "Size for target mixed supply" : "Size required boosted flow";
    outputs["chart-title"].textContent = "Boosted flow vs required outlet temperature";
    drawOutletChart(inlet, target, result.boostedShare, modeLabel);
  }
  const warning = requiredElement("extreme-warning");
  warning.hidden = !(mode === "target" && result.boostOutlet >= 100);
  warning.textContent = "Above 100 °C is possible in pressurized district-heating systems. Verify system pressure and equipment ratings; this simplified sizing model is advisory only.";
}

form.addEventListener("input", update);
form.addEventListener("submit", event => event.preventDefault());
modeButtons.forEach(button => button.addEventListener("click", () => {
  mode = button.dataset.mode;
  modeButtons.forEach(item => {
    const active = item === button;
    item.classList.toggle("active", active);
    item.setAttribute("aria-pressed", String(active));
  });
  update();
}));
caseSelect.addEventListener("change", () => {
  const item = examples[Number(caseSelect.value)];
  if (!item) return;
  for (const [key, value] of Object.entries(item)) if (key !== "name") fields[key].value = value;
  update();
});

update();
