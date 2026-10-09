import { calculate, calculateTargetMode, solveBoostFlow, solveBoostOutlet, validateInputs } from "./calculator.js";

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
function inputElement(name) {
  const element = form.elements[name];
  if (!element) throw new Error(`Required form input [name="${name}"] is missing.`);
  return element;
}
const form = requiredElement("calc-form");
const caseSelect = requiredElement("case-select");
let mode = "direct";
const ids = Object.fromEntries(["mixed-result", "target-result", "required-outlet-result", "dilution-explanation", "results-title", "thermal-result", "electric-result", "source-result", "bypass-result", "share-result", "lift-result", "validation", "status-text", "status-badge", "schematic-inlet", "schematic-total", "schematic-boost-flow", "schematic-boost-out", "schematic-bypass", "schematic-mixed", "schematic-target", "power-point"].map(id => [id, requiredElement(id)]));
const fmt = (value, digits = 1) => Number.isFinite(value) ? value.toLocaleString("en-GB", { maximumFractionDigits: digits, minimumFractionDigits: digits }) : "—";

for (const [index, item] of examples.entries()) {
  const option = document.createElement("option"); option.value = String(index); option.textContent = item.name; caseSelect.append(option);
}

function readInput() {
  return Object.fromEntries(["totalFlow", "inletTemp", "targetTemp", "boostFlow", "boostOutlet", "cop", "sourceTemp"].map(key => [key, inputElement(key).value]));
}
function displayError(errors) {
  ids.validation.hidden = !errors.length;
  ids.validation.replaceChildren();
  if (!errors.length) return;
  const strong = document.createElement("strong"); strong.textContent = "CHECK OPERATING POINT";
  const list = document.createElement("ul");
  for (const error of errors) { const li = document.createElement("li"); li.textContent = error; list.append(li); }
  ids.validation.append(strong, list);
}
const setText = (id, value) => { ids[id].textContent = value; };

function drawOutletChart(inlet, target, currentShare) {
  const svg = requiredElement("outlet-chart"), ns = "http://www.w3.org/2000/svg";
  svg.replaceChildren();
  const plot = { left: 68, top: 18, width: 650, height: 222 };
  const outletAt = share => inlet + (target - inlet) / (share / 100);
  const min = Math.min(inlet, target), max = outletAt(1);
  const pad = Math.max((max - min) * 0.06, 1), low = min - pad, high = max + pad;
  const x = share => plot.left + plot.width * share / 100;
  const y = temp => plot.top + plot.height * (high - temp) / (high - low);
  const el = (tag, attrs, content) => {
    const node = document.createElementNS(ns, tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    if (content != null) node.textContent = content;
    svg.append(node); return node;
  };
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
  const points = Array.from({ length: 100 }, (_, i) => {
    const share = i + 1;
    return `${x(share)},${y(outletAt(share))}`;
  }).join(" ");
  el("polyline", { points, class: "chart-curve" });
  const markerShare = Math.max(0, Math.min(100, currentShare));
  const markerY = y(markerShare === 0 ? high : outletAt(markerShare));
  el("line", { x1: x(markerShare), x2: x(markerShare), y1: plot.top, y2: plot.top + plot.height, class: "chart-current-line" });
  el("circle", { cx: x(markerShare), cy: markerY, r: 7, class: "chart-current-marker" });
  el("text", { x: plot.left + plot.width / 2, y: 291, "text-anchor": "middle", class: "chart-axis-title" }, "BOOSTED-FLOW SHARE OF TOTAL NETWORK FLOW");
  el("text", { x: 17, y: plot.top + plot.height / 2, "text-anchor": "middle", transform: `rotate(-90 17 ${plot.top + plot.height / 2})`, class: "chart-axis-title" }, "REQUIRED BOOSTER OUTLET (°C)");
  requiredElement("outlet-chart-desc").textContent = `Outlet temperature falls from ${fmt(outletAt(1))} degrees at 1 percent boosted flow to ${fmt(target)} degrees at 100 percent boosted flow. Current share is ${fmt(currentShare)} percent.`;
}

function update() {
  const input = readInput();
  if (mode === "target") {
    try {
      const result = calculateTargetMode(input), target = Number(input.targetTemp);
      displayError([]);
      requiredElement("target-mode-result").hidden = false;
      requiredElement("target-chart-section").hidden = false;
      inputElement("boostOutlet").value = result.boostOutlet;
      setText("mixed-result", fmt(result.mixedTemp, 2)); setText("target-result", fmt(target));
      setText("required-outlet-result", fmt(result.boostOutlet, 2));
      setText("dilution-explanation", `If the booster only reaches the network target (${fmt(target)} °C), mixing with ${fmt(result.bypassFlow)} m³/h of bypass flow gives just ${fmt(result.mixedIfOutletOnlyTarget, 2)} °C. The boosted stream needs a higher outlet temperature to compensate for dilution.`);
      const extreme = requiredElement("extreme-warning");
      extreme.hidden = result.boostOutlet < 100;
      extreme.textContent = "Above 100 °C: this exceeds water’s boiling point at atmospheric pressure. Pressurized district-heating systems can operate above it; confirm system pressure and component ratings. Advisory only, not a feasibility cutoff.";
      setText("thermal-result", fmt(result.thermalPower)); setText("electric-result", fmt(result.electricPower));
      setText("source-result", fmt(result.sourceHeat)); setText("bypass-result", fmt(result.bypassFlow));
      setText("share-result", fmt(result.boostedShare)); setText("lift-result", fmt(result.temperatureLift));
      setText("schematic-inlet", `${fmt(Number(input.inletTemp))}°C`); setText("schematic-total", `${fmt(Number(input.totalFlow))} m³/h`);
      setText("schematic-boost-flow", `${fmt(Number(input.boostFlow))} m³/h`); setText("schematic-boost-out", `${fmt(result.boostOutlet)}°C`);
      setText("schematic-bypass", `${fmt(result.bypassFlow)} m³/h`); setText("schematic-mixed", `${fmt(result.mixedTemp, 2)}°C`);
      setText("schematic-target", `${fmt(target)}°C`);
      ids["results-title"].textContent = "Target mixed-outlet result";
      setText("status-text", "Required booster temperature includes bypass dilution");
      ids["status-badge"].textContent = "TARGET SOLVED"; ids["status-badge"].className = "status-badge";
      setText("power-point", `${fmt(Number(input.boostFlow))} m³/h · ${fmt(Number(input.inletTemp))} → ${fmt(result.boostOutlet)} °C`);
      drawOutletChart(Number(input.inletTemp), target, result.boostedShare);
    } catch (error) {
      displayError([error.message]);
      requiredElement("target-mode-result").hidden = true;
      requiredElement("target-chart-section").hidden = true;
      for (const id of ["mixed-result", "target-result", "required-outlet-result", "thermal-result", "electric-result", "source-result", "bypass-result", "share-result", "lift-result", "schematic-inlet", "schematic-total", "schematic-boost-flow", "schematic-boost-out", "schematic-bypass", "schematic-mixed"]) setText(id, "—");
      ids["results-title"].textContent = "Target mixed-outlet result";
      ids["status-badge"].textContent = "CHECK"; ids["status-badge"].className = "status-badge warning";
      setText("status-text", "Correct the inputs to calculate");
    }
    return;
  }
  requiredElement("target-mode-result").hidden = true;
  requiredElement("target-chart-section").hidden = true;
  ids["results-title"].textContent = "Calculated result";
  const errors = validateInputs(input);
  displayError(errors);
  if (errors.length) {
    ids["status-badge"].textContent = "CHECK"; ids["status-badge"].className = "status-badge warning";
    ids["status-text"].textContent = "Correct the inputs to calculate";
    for (const id of ["mixed-result", "thermal-result", "electric-result", "source-result", "bypass-result", "share-result", "lift-result", "schematic-inlet", "schematic-total", "schematic-boost-flow", "schematic-boost-out", "schematic-bypass", "schematic-mixed"]) ids[id].textContent = "—";
    return;
  }
  const result = calculate(input), target = Number(input.targetTemp), delta = result.mixedTemp - target;
  const targetReachable = target >= Number(input.inletTemp) && target <= Number(input.boostOutlet);
  const onTarget = targetReachable && Math.abs(delta) < 0.05;
  ids["mixed-result"].textContent = fmt(result.mixedTemp, 2); ids["target-result"].textContent = fmt(target, 1);
  ids["thermal-result"].textContent = fmt(result.thermalPower); ids["electric-result"].textContent = fmt(result.electricPower);
  ids["source-result"].textContent = fmt(result.sourceHeat); ids["bypass-result"].textContent = fmt(result.bypassFlow);
  ids["share-result"].textContent = fmt(result.boostedShare); ids["lift-result"].textContent = fmt(result.temperatureLift);
  ids["schematic-inlet"].textContent = `${fmt(Number(input.inletTemp))}°C`; ids["schematic-total"].textContent = `${fmt(Number(input.totalFlow))} m³/h`;
  ids["schematic-boost-flow"].textContent = `${fmt(Number(input.boostFlow))} m³/h`;
  ids["schematic-boost-out"].textContent = `${fmt(Number(input.boostOutlet))}°C`;
  ids["schematic-bypass"].textContent = `${fmt(result.bypassFlow)} m³/h`;
  ids["schematic-mixed"].textContent = `${fmt(result.mixedTemp, 2)}°C`; ids["schematic-target"].textContent = `${fmt(target)}°C`;
  ids["status-badge"].textContent = onTarget ? "ON TARGET" : targetReachable ? "FEASIBLE" : "UNREACHABLE";
  ids["status-badge"].className = `status-badge ${!targetReachable ? "warning" : ""}`;
  ids["status-text"].textContent = onTarget ? "Mixed supply is within 0.05 °C of target" : targetReachable ? `${fmt(Math.abs(delta), 2)} °C ${delta < 0 ? "below" : "above"} target` : "Target is outside the achievable mixing range";
  ids["power-point"].textContent = `${fmt(Number(input.boostFlow))} m³/h · ${fmt(Number(input.inletTemp))} → ${fmt(Number(input.boostOutlet))} °C`;
  ids["results-title"].textContent = "Calculated result";
}

form.addEventListener("input", update);
document.querySelectorAll(".mode-button").forEach(button => button.addEventListener("click", () => {
  mode = button.dataset.mode;
  document.querySelectorAll(".mode-button").forEach(item => {
    const active = item === button;
    item.classList.toggle("active", active); item.setAttribute("aria-pressed", String(active));
  });
  const targetMode = mode === "target";
  inputElement("boostOutlet").disabled = targetMode;
  requiredElement("booster-outlet-field").hidden = targetMode;
  requiredElement("mode-description").textContent = targetMode
    ? "Set the mixed-network target; booster outlet and power are solved after accounting for bypass dilution."
    : "Set the booster outlet temperature and see the resulting mixed supply.";
  update();
}));
caseSelect.addEventListener("change", () => {
  const item = examples[Number(caseSelect.value)];
  for (const [key, value] of Object.entries(item)) if (key !== "name") inputElement(key).value = value;
  update();
});
document.querySelectorAll("[data-solve]").forEach(button => button.addEventListener("click", () => {
  const input = readInput(), message = requiredElement("reverse-message");
  try {
    const mode = button.dataset.solve;
    if (mode === "flow") {
      const value = solveBoostFlow(input, Number(requiredElement("reverse-flow-target").value));
      requiredElement("reverse-flow-output").textContent = `${fmt(value)} m³/h required`;
      message.textContent = value > Number(input.totalFlow) ? "Impossible: the required boosted flow exceeds total network flow." : "Required boosted flow calculated from the mixing balance.";
    } else if (mode === "outlet") {
      const value = solveBoostOutlet(input, Number(requiredElement("reverse-outlet-target").value));
      requiredElement("reverse-outlet-output").textContent = `${fmt(value)} °C required`;
      message.textContent = value < Number(input.inletTemp) ? "Impossible: required outlet is below network supply." : "Required booster outlet temperature calculated.";
    } else {
      const result = calculate(input);
      requiredElement("reverse-power-output").textContent = `${fmt(result.thermalPower)} kW thermal`;
      message.textContent = `Heat pump input ${fmt(result.electricPower)} kW electric · ${fmt(result.sourceHeat)} kW source heat extracted.`;
    }
  } catch (error) { message.textContent = `Cannot solve: ${error.message}`; }
}));

update();
