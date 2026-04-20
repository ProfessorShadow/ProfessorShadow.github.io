const DATA_URL = "../data/dashboard-data.json";
const AU_STATES_GEOJSON_URL = "https://raw.githubusercontent.com/rowanhogan/australian-states/master/states.geojson";

const kpiStyles = {
  openCases: "primary",
  assignedCases: "neutral",
  aged15Days: "warn",
  aged30Days: "warn",
  closedWeek: "good",
};

const kpiOrder = ["openCases", "assignedCases", "aged15Days", "aged30Days", "closedWeek"];
const matrixStatuses = ["Open", "Assigned", "Work In Progress", "Pending Customer", "Customer Responded", "Escalated", "Resolved"];
const stateCodeNames = {
  NSW: "New South Wales",
  VIC: "Victoria",
  QLD: "Queensland",
  WA: "Western Australia",
  SA: "South Australia",
  TAS: "Tasmania",
  NT: "Northern Territory",
  ACT: "Australian Capital Territory",
};
const stateNameCodes = Object.fromEntries(Object.entries(stateCodeNames).map(([code, name]) => [name.toLowerCase(), code]));
const australiaCentroids = {
  WA: [-25.0, 122.2],
  NT: [-19.4, 133.4],
  SA: [-30.0, 135.2],
  QLD: [-22.4, 144.4],
  NSW: [-32.6, 147.1],
  ACT: [-35.3, 149.1],
  VIC: [-37.0, 144.7],
  TAS: [-42.1, 146.6],
};

const state = { data: null, filters: {}, australiaMap: null, australiaShapeLayer: null, australiaBubbleLayer: null, australiaGeojsonPromise: null };

function number(value) {
  return new Intl.NumberFormat("en-AU").format(value);
}

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function pct(value, max) {
  if (!max) return 0;
  return Math.max(4, Math.round((value / max) * 100));
}

function countBy(rows, key, limit, skipValues = []) {
  const skip = new Set(skipValues);
  const counts = new Map();
  rows.forEach((row) => {
    const value = row[key] || "Unknown";
    if (skip.has(value)) return;
    counts.set(value, (counts.get(value) || 0) + 1);
  });
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit || counts.size)
    .map(([label, value]) => ({ label, value }));
}

function isOpenCase(row) {
  return !row.isClosed;
}

function asDate(value) {
  return value ? new Date(value) : null;
}

function isClosedInWeek(row, meta) {
  const closedAt = asDate(row.closedAt);
  if (!closedAt) return false;
  const weekStart = new Date(`${meta.weekStart}T00:00:00`);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 7);
  return closedAt >= weekStart && closedAt < weekEnd;
}

function matchesStatus(row, status) {
  if (!status) return true;
  if (status === "Open") return !row.isClosed;
  if (status === "Assigned") return row.ownerName === "S&O Case Queue" || row.funnelStatus === "Assigned";
  if (status === "In Review") return ["Work In Progress", "Customer Responded"].includes(row.funnelStatus);
  if (status === "Resolved") return row.isClosed || row.funnelStatus === "Resolved";
  return row.funnelStatus === status || row.status === status;
}

function matchesKpi(row, kpiId, meta) {
  if (!kpiId) return true;
  if (kpiId === "openCases") return isOpenCase(row);
  if (kpiId === "assignedCases") return isOpenCase(row) && row.ownerName === "S&O Case Queue";
  if (kpiId === "aged15Days") return isOpenCase(row) && row.ageDays >= 15;
  if (kpiId === "aged30Days") return isOpenCase(row) && row.ageDays >= 30;
  if (kpiId === "closedWeek") return row.isClosed && isClosedInWeek(row, meta);
  return true;
}

function rowMatchesFilters(row, filters) {
  if (filters.ownerName && row.ownerName !== filters.ownerName) return false;
  if (filters.caseSubType && row.caseSubType !== filters.caseSubType) return false;
  if (filters.stateName && (row.stateName || row.businessUnit) !== filters.stateName) return false;
  if (filters.status && !matchesStatus(row, filters.status)) return false;
  return true;
}

function filteredCases(extraFilters = {}) {
  const filters = { ...state.filters, ...extraFilters };
  return state.data.records.cases.filter((row) => rowMatchesFilters(row, filters));
}

function summarize(cases, meta) {
  const openCases = cases.filter(isOpenCase);
  const closedWeek = cases.filter((row) => row.isClosed && isClosedInWeek(row, meta));
  const queueAssigned = openCases.filter((row) => row.ownerName === "S&O Case Queue");
  const inReview = openCases.filter((row) => ["Work In Progress", "Customer Responded"].includes(row.funnelStatus));
  const escalated = openCases.filter((row) => row.funnelStatus === "Escalated" || row.status === "Escalated");
  return {
    kpis: {
      openCases: { label: "Open Cases", value: openCases.length, delta: "+12%" },
      assignedCases: { label: "Assigned Cases", value: queueAssigned.length, delta: "0%" },
      aged15Days: { label: "Aged 15+ Days", value: openCases.filter((row) => row.ageDays >= 15).length, delta: "+4%" },
      aged30Days: { label: "Aged 30+ Days", value: openCases.filter((row) => row.ageDays >= 30).length, delta: "-8%" },
      closedWeek: { label: "Closed Week", value: closedWeek.length, delta: "+18%" },
    },
    casesByMember: countBy(openCases, "ownerName", 5, ["Other", "S&O Case Queue"]),
    caseTypes: countBy(openCases, "caseSubType", 5),
    statusBreakdown: [
      { label: "Assigned", value: queueAssigned.length },
      { label: "Open", value: openCases.length },
      { label: "In Review", value: inReview.length },
      { label: "Escalated", value: escalated.length },
    ],
    closurePerformance: closurePerformance(cases, meta),
    stateDistribution: countBy(openCases, "stateName", 8, ["-"]),
    teamMatrix: teamMatrix(cases),
  };
}

function closurePerformance(cases, meta) {
  const openCases = cases.filter(isOpenCase);
  const owners = countBy(openCases, "ownerName", 5, ["Other", "S&O Case Queue"]).map((item) => item.label);
  const asOf = new Date(meta.asOf);
  return owners.map((ownerName) => {
    const ownerClosed = cases.filter((row) => row.ownerName === ownerName && row.isClosed);
    return {
      label: ownerName,
      today: ownerClosed.filter((row) => {
        const closedAt = asDate(row.closedAt);
        return closedAt && closedAt.toDateString() === asOf.toDateString();
      }).length,
      week: ownerClosed.filter((row) => isClosedInWeek(row, meta)).length,
    };
  }).sort((a, b) => b.week - a.week || b.today - a.today || a.label.localeCompare(b.label));
}

function initials(name) {
  const parts = String(name).split(" ").filter(Boolean);
  return `${parts[0]?.[0] || ""}${parts.at(-1)?.[0] || ""}`.toUpperCase();
}

function teamMatrix(cases) {
  const openCases = cases.filter(isOpenCase);
  const owners = countBy(openCases, "ownerName", 5, ["Other", "S&O Case Queue"]).map((item) => item.label);
  return {
    statuses: matrixStatuses,
    members: owners.map((name) => {
      const ownerOpen = openCases.filter((row) => row.ownerName === name);
      const values = {};
      matrixStatuses.forEach((status) => {
        values[status] = ownerOpen.filter((row) => matchesStatus(row, status)).length;
      });
      return { name, role: "Sales & Onboarding", avatar: initials(name), values, resolved: cases.filter((row) => row.ownerName === name && row.isClosed).length };
    }),
  };
}

function filterLabel(key) {
  return { ownerName: "Member", caseSubType: "Case Type", status: "Status", stateName: "State" }[key] || key;
}

function setFilter(key, value) {
  if (state.filters[key] === value) delete state.filters[key];
  else state.filters[key] = value;
  render();
}

function clearFilter(key) {
  delete state.filters[key];
  render();
}

function clearFilters() {
  state.filters = {};
  render();
}

function renderFilterStrip() {
  const strip = document.getElementById("filter-strip");
  const entries = Object.entries(state.filters);
  if (!entries.length) {
    strip.innerHTML = `<span class="filter-empty">Click a card, bar, state, or heatmap cell to filter. Click a KPI to open drilldown.</span>`;
    return;
  }
  strip.innerHTML = entries.map(([key, value]) => `<button class="filter-chip" data-filter-key="${escapeHtml(key)}"><span>${escapeHtml(filterLabel(key))}</span>${escapeHtml(value)} ×</button>`).join("") + `<button class="clear-filters">Clear filters</button>`;
  strip.querySelectorAll(".filter-chip").forEach((button) => button.addEventListener("click", () => clearFilter(button.dataset.filterKey)));
  strip.querySelector(".clear-filters").addEventListener("click", clearFilters);
}

function isSelected(key, value) {
  return state.filters[key] === value ? "selected" : "";
}

function renderKpis(kpis) {
  const grid = document.getElementById("kpi-grid");
  grid.innerHTML = kpiOrder.map((id) => {
    const item = kpis[id];
    const style = kpiStyles[id];
    const deltaClass = item.delta.includes("-") ? "" : item.delta === "0%" ? "neutral" : style === "warn" ? "warn" : "";
    return `<article class="kpi-card ${style} interactive" data-kpi="${escapeHtml(id)}"><div class="kpi-label">${escapeHtml(item.label)}</div><div class="kpi-row"><div class="kpi-value">${number(item.value)}</div><span class="delta ${deltaClass}">${escapeHtml(item.delta)}</span></div></article>`;
  }).join("");
  grid.querySelectorAll("[data-kpi]").forEach((card) => card.addEventListener("click", () => openDrilldown(card.dataset.kpi)));
}

function renderBarList(id, items, filterKey) {
  const max = Math.max(...items.map((item) => item.value), 1);
  const container = document.getElementById(id);
  container.innerHTML = items.map((item) => `<div class="bar-item interactive ${isSelected(filterKey, item.label)}" data-filter-key="${escapeHtml(filterKey)}" data-filter-value="${escapeHtml(item.label)}"><div class="bar-meta"><span>${escapeHtml(item.label)}</span><strong>${number(item.value)}</strong></div><div class="bar-track"><i class="bar-fill" style="--w:${pct(item.value, max)}%"></i></div></div>`).join("");
  container.querySelectorAll("[data-filter-key]").forEach((item) => item.addEventListener("click", () => setFilter(item.dataset.filterKey, item.dataset.filterValue)));
}

function renderClosure(items) {
  const max = Math.max(...items.flatMap((item) => [item.today, item.week]), 1);
  document.getElementById("closure-performance").innerHTML = items.map((item) => `
    <div class="closure-item interactive ${isSelected("ownerName", item.label)}" data-filter-key="ownerName" data-filter-value="${escapeHtml(item.label)}">
      <div class="bar-meta">
        <span>${escapeHtml(item.label)}</span>
        <span class="closure-numbers"><span>${number(item.today)} Today</span><span>${number(item.week)} Week</span></span>
      </div>
      <div class="closure-comparison" aria-label="${escapeHtml(item.label)} closure comparison">
        <div class="comparison-row today"><span>Today</span><div class="closure-track"><i style="--w:${pct(item.today, max)}%"></i></div><strong>${number(item.today)}</strong></div>
        <div class="comparison-row week"><span>Week</span><div class="closure-track"><i style="--w:${pct(item.week, max)}%"></i></div><strong>${number(item.week)}</strong></div>
      </div>
    </div>
  `).join("");
  document.querySelectorAll(".closure-item").forEach((item) => item.addEventListener("click", () => setFilter(item.dataset.filterKey, item.dataset.filterValue)));
}

function choroplethColor(value, max) {
  if (!value) return "#f5f8fc";
  const intensity = value / Math.max(max, 1);
  const lightness = 94 - intensity * 24;
  const saturation = 54 + intensity * 16;
  return `hsl(216 ${saturation.toFixed(0)}% ${lightness.toFixed(0)}%)`;
}

function featureStateCode(feature) {
  const props = feature?.properties || {};
  const raw = props.STATE_NAME || props.STE_NAME16 || props.name || props.Name || props.STATE || props.state || props.code || "";
  const upper = String(raw).toUpperCase();
  if (stateCodeNames[upper]) return upper;
  return stateNameCodes[String(raw).toLowerCase()] || upper;
}

function initAustraliaLeaflet(container) {
  if (state.australiaMap || !window.L) return;
  const bounds = L.latLngBounds([-44.3, 112.2], [-9.2, 154.3]);
  state.australiaMap = L.map(container, {
    attributionControl: true,
    boxZoom: false,
    dragging: false,
    doubleClickZoom: false,
    zoomControl: false,
    scrollWheelZoom: false,
    maxBounds: bounds,
    maxBoundsViscosity: 1,
    zoomSnap: 0.1,
  });
  state.australiaMap.attributionControl.setPrefix("");
  state.australiaMap.attributionControl.addAttribution("&copy; OpenStreetMap contributors");
  state.australiaMap.fitBounds(bounds, { animate: true, padding: [8, 8] });
}

function renderAustraliaFallback(container, items) {
  container.innerHTML = `
    <div class="map-fallback">
      <span>Australia map source is loading.</span>
      <div>${items.map((item) => `<button data-filter-key="stateName" data-filter-value="${escapeHtml(item.label)}">${escapeHtml(item.label)} ${number(item.value)}</button>`).join("")}</div>
    </div>
  `;
  container.querySelectorAll("[data-filter-key]").forEach((item) => item.addEventListener("click", () => setFilter(item.dataset.filterKey, item.dataset.filterValue)));
}

function renderAustraliaBubbles(counts, max) {
  if (!window.L || !state.australiaMap) return;
  if (state.australiaBubbleLayer) state.australiaBubbleLayer.remove();
  state.australiaBubbleLayer = L.layerGroup().addTo(state.australiaMap);
  Object.entries(australiaCentroids).forEach(([code, latlng]) => {
    const value = counts.get(code) || 0;
    const marker = L.circleMarker(latlng, {
      radius: value ? 4 + (value / Math.max(max, 1)) * 22 : 3,
      color: state.filters.stateName === code ? "#1f2a3a" : "#ffffff",
      weight: state.filters.stateName === code ? 2 : 1,
      className: `state-bubble ${isSelected("stateName", code)}`,
      fillColor: "rgba(234, 239, 247, 0.9)",
      fillOpacity: 0.92,
    }).addTo(state.australiaBubbleLayer);
    marker.bindTooltip(`${code}: ${number(value)} cases`);
    marker.on("click", () => setFilter("stateName", code));
    const element = marker.getElement();
    if (element) element.setAttribute("data-state", code);
  });
}

async function renderAustraliaMap(items) {
  const container = document.getElementById("australia-map");
  container.dataset.provider = "openstreetmap";
  container.dataset.view = "australia-only";
  const counts = new Map(items.map((item) => [item.label, item.value]));
  const max = Math.max(...items.map((item) => item.value), 1);
  if (!window.L) {
    renderAustraliaFallback(container, items);
    return;
  }
  initAustraliaLeaflet(container);
  if (!state.australiaGeojsonPromise) {
    state.australiaGeojsonPromise = fetch(AU_STATES_GEOJSON_URL).then((response) => {
      if (!response.ok) throw new Error(`Australia GeoJSON ${response.status}`);
      return response.json();
    });
  }
  try {
    const geojson = await state.australiaGeojsonPromise;
    if (state.australiaShapeLayer) state.australiaShapeLayer.remove();
    state.australiaShapeLayer = L.geoJSON(geojson, {
      style: (feature) => {
        const code = featureStateCode(feature);
        const value = counts.get(code) || 0;
        return {
          color: state.filters.stateName === code ? "#4e5967" : "#95a0ae",
          fillColor: choroplethColor(value, max),
          fillOpacity: 0.86,
          weight: state.filters.stateName === code ? 1.7 : 0.8,
        };
      },
      onEachFeature: (feature, layer) => {
        const code = featureStateCode(feature);
        const value = counts.get(code) || 0;
        layer.bindTooltip(`${code}: ${number(value)} cases`);
        layer.on("click", () => setFilter("stateName", code));
      },
    }).addTo(state.australiaMap);
    state.australiaShapeLayer.eachLayer((layer) => {
      const code = featureStateCode(layer.feature);
      const element = layer.getElement();
      if (code && element) element.setAttribute("data-state", code);
    });
    renderAustraliaBubbles(counts, max);
  } catch {
    renderAustraliaFallback(container, items);
    renderAustraliaBubbles(counts, max);
  }
}

function renderStates(items) {
  const max = Math.max(...items.map((item) => item.value), 1);
  renderAustraliaMap(items);
  document.getElementById("state-cards").innerHTML = items.map((item) => `<div class="state-card interactive ${isSelected("stateName", item.label)}" style="--state-color:${choroplethColor(item.value, max)}" data-filter-key="stateName" data-filter-value="${escapeHtml(item.label)}"><div class="state-label">${escapeHtml(item.label)}</div><div class="state-value">${number(item.value)} Cases</div></div>`).join("");
  document.querySelectorAll("#state-cards [data-filter-key]").forEach((item) => item.addEventListener("click", () => setFilter(item.dataset.filterKey, item.dataset.filterValue)));
}

function heat(value, max) {
  if (!value) return "#f6f8fb";
  const alpha = 0.12 + (value / max) * 0.52;
  return `rgba(69, 119, 184, ${alpha.toFixed(2)})`;
}

function renderMatrix(matrix) {
  document.getElementById("team-matrix-header").innerHTML = ["Team Member", ...matrix.statuses].map((label) => `<div>${label === "Work In Progress" ? "WIP" : escapeHtml(label)}</div>`).join("");
  const max = Math.max(...matrix.members.flatMap((member) => [...Object.values(member.values), member.resolved]), 1);
  document.getElementById("team-matrix").innerHTML = matrix.members.map((member) => {
    const cells = matrix.statuses.map((status) => {
      const value = status === "Resolved" ? member.resolved : member.values[status] || 0;
      return `<div class="matrix-cell interactive ${isSelected("ownerName", member.name)} ${isSelected("status", status)}" style="--heat:${heat(value, max)}" data-owner="${escapeHtml(member.name)}" data-status="${escapeHtml(status)}">${number(value)}</div>`;
    }).join("");
    return `<div class="matrix-row"><div class="member-cell interactive ${isSelected("ownerName", member.name)}" data-filter-key="ownerName" data-filter-value="${escapeHtml(member.name)}"><span class="avatar">${escapeHtml(member.avatar)}</span><span><div class="member-name">${escapeHtml(member.name)}</div><div class="member-role">${escapeHtml(member.role)}</div></span></div>${cells}</div>`;
  }).join("");
  document.querySelectorAll(".member-cell[data-filter-key]").forEach((cell) => cell.addEventListener("click", () => setFilter(cell.dataset.filterKey, cell.dataset.filterValue)));
  document.querySelectorAll(".matrix-cell[data-owner]").forEach((cell) => {
    cell.addEventListener("click", () => {
      state.filters.ownerName = cell.dataset.owner;
      state.filters.status = cell.dataset.status;
      render();
      openDrilldown(null);
    });
  });
}

function openDrilldown(kpiId) {
  const rows = filteredCases().filter((row) => matchesKpi(row, kpiId, state.data.meta)).slice(0, 150);
  document.getElementById("drilldown-title").textContent = kpiId ? state.data.kpis[kpiId].label : "Filtered Cases";
  document.getElementById("drilldown-subtitle").textContent = `${number(rows.length)} matching cases. Showing up to 150 rows.`;
  document.getElementById("drilldown-body").innerHTML = rows.length ? rows.map((row) => `<tr><td>${escapeHtml(row.caseNumber || row.caseId)}</td><td>${escapeHtml(row.ownerName)}</td><td>${escapeHtml(row.caseSubType)}</td><td>${escapeHtml(row.funnelStatus)}</td><td>${escapeHtml(row.stateName || row.businessUnit)}</td><td>${number(row.ageDays)}d</td></tr>`).join("") : `<tr><td colspan="6" class="empty-row">No cases match the current selection.</td></tr>`;
  document.getElementById("drilldown").classList.add("open");
  document.getElementById("drilldown").setAttribute("aria-hidden", "false");
}

function closeDrilldown() {
  document.getElementById("drilldown").classList.remove("open");
  document.getElementById("drilldown").setAttribute("aria-hidden", "true");
}

function renderMeta(meta) {
  document.getElementById("dashboard-title").textContent = meta.title;
  document.getElementById("dashboard-subtitle").textContent = meta.subtitle;
}

function render() {
  const summary = summarize(filteredCases(), state.data.meta);
  renderFilterStrip();
  renderKpis(summary.kpis);
  renderBarList("cases-by-member", summary.casesByMember, "ownerName");
  renderBarList("case-types", summary.caseTypes, "caseSubType");
  renderBarList("status-breakdown", summary.statusBreakdown, "status");
  renderClosure(summary.closurePerformance);
  renderStates(summary.stateDistribution);
  renderMatrix(summary.teamMatrix);
}

async function init() {
  const response = await fetch(DATA_URL);
  if (!response.ok) throw new Error(`Unable to load ${DATA_URL}`);
  state.data = await response.json();
  renderMeta(state.data.meta);
  render();
  document.getElementById("close-drilldown").addEventListener("click", closeDrilldown);
  document.getElementById("drilldown").addEventListener("click", (event) => {
    if (event.target.id === "drilldown") closeDrilldown();
  });
}

init().catch((error) => {
  document.body.innerHTML = `<pre style="padding:24px;color:#b12b2c">${escapeHtml(error.message)}</pre>`;
});
