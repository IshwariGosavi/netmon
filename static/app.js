// Where each device sits on the map (SVG coordinates, map is 800 x 400)
const POS = {
  R1:  {x: 400, y: 50},
  SW1: {x: 200, y: 170},
  SW2: {x: 600, y: 170},
  PC1: {x: 100, y: 320},
  PC2: {x: 300, y: 320},
  SRV: {x: 500, y: 320},
  PC3: {x: 700, y: 320},
};

const COLORS = {
  UP: "#2e9e4f",
  DEGRADED: "#e0a800",
  DOWN: "#d63a3a",
  UNREACHABLE: "#8a8f98",
};

let devices = [];        // latest data from the backend
let uptime = {};         // uptime % for each device
let history = [];        // recent latency readings of the selected device
let selectedId = null;   // which device is clicked

// ---------- refresh loop ----------

async function refresh() {
  try {
    const [s, e, u] = await Promise.all([
      fetch("/api/status"), fetch("/api/events"), fetch("/api/uptime")]);
    devices = await s.json();
    const events = await e.json();
    uptime = await u.json();

    if (selectedId) {
      const h = await fetch("/api/history/" + selectedId);
      history = await h.json();
    } else {
      history = [];
    }

    drawMap();
    drawCounters();
    drawBanner();
    drawDetails();
    drawLog(events);
  } catch (err) {
    const b = document.getElementById("banner");
    b.className = "banner alert";
    b.textContent = "Cannot reach the monitoring server";
  }
}

refresh();
setInterval(refresh, 2000);

// ---------- map ----------

function drawMap() {
  const svg = document.getElementById("map");
  let html = "";

  // 1. links first, so the circles sit on top of them
  for (const d of devices) {
    if (d.parent) {
      const a = POS[d.parent], b = POS[d.id];
      const broken = d.status === "DOWN" || d.status === "UNREACHABLE";
      html += `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"
                stroke="${broken ? "#d63a3a" : "#999"}" stroke-width="2"
                ${broken ? 'stroke-dasharray="6 4"' : ""}/>`;
    }
  }

  // 2. devices
  for (const d of devices) {
    const p = POS[d.id];
    const outline = d.id === selectedId
      ? 'stroke="#222" stroke-width="4"'
      : 'stroke="#fff" stroke-width="2"';
    html += `
      <g onclick="selectDevice('${d.id}')" style="cursor:pointer">
        <circle cx="${p.x}" cy="${p.y}" r="28" fill="${COLORS[d.status]}" ${outline}/>
        <text x="${p.x}" y="${p.y + 5}" text-anchor="middle"
              fill="#fff" font-size="13" font-weight="bold">${d.id}</text>
        <text x="${p.x}" y="${p.y + 48}" text-anchor="middle"
              fill="#555" font-size="11">${d.ip}</text>
      </g>`;
  }

  svg.innerHTML = html;
}

function selectDevice(id) {
  selectedId = id;
  refresh();
}

// ---------- counters and banner ----------

function drawCounters() {
  for (const s of ["UP", "DEGRADED", "DOWN", "UNREACHABLE"]) {
    const n = devices.filter(d => d.status === s).length;
    document.getElementById("c-" + s.toLowerCase()).textContent = n;
  }
}

function drawBanner() {
  const b = document.getElementById("banner");
  const down = devices.filter(d => d.status === "DOWN");
  const unreach = devices.filter(d => d.status === "UNREACHABLE");
  const slow = devices.filter(d => d.status === "DEGRADED");

  if (down.length) {
    b.className = "banner alert";
    b.textContent = "ALERT: " + down.map(d => d.id).join(", ") + " DOWN" +
      (unreach.length ? ` (${unreach.length} device(s) unreachable as a result)` : "");
  } else if (slow.length) {
    b.className = "banner warn";
    b.textContent = "WARNING: " + slow.map(d => d.id).join(", ") + " responding slowly";
  } else {
    b.className = "banner ok";
    b.textContent = "All systems operational";
  }
}

// ---------- details panel and latency graph ----------

function latencyGraph(points) {
  if (points.length < 2) return "<p>Collecting data...</p>";
  const W = 260, H = 90, MAX = 200;           // graph covers 0 to 200 ms
  const step = W / (points.length - 1);
  let path = "", dots = "", pen = false;

  points.forEach((p, i) => {
    const x = i * step;
    if (p.latency === null) {                  // missed ping: red dot, break the line
      dots += `<circle cx="${x}" cy="${H}" r="3" fill="#d63a3a"/>`;
      pen = false;
    } else {
      const y = H - Math.min(p.latency, MAX) / MAX * H;
      path += (pen ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1) + " ";
      pen = true;
    }
  });

  const limitY = H - 100 / MAX * H;            // the 100 ms DEGRADED limit
  return `<svg viewBox="-4 -6 ${W + 8} ${H + 12}" width="100%">
      <line x1="0" y1="${limitY}" x2="${W}" y2="${limitY}" stroke="#e0a800" stroke-dasharray="4 3"/>
      <path d="${path}" fill="none" stroke="#2e6fd6" stroke-width="2"/>
      ${dots}
    </svg>
    <small>Last 60 s. Dashed line = 100 ms limit. Red dot = missed ping.</small>`;
}

function drawDetails() {
  const box = document.getElementById("details");
  const d = devices.find(x => x.id === selectedId);
  if (!d) {
    box.innerHTML = "<h3>Device details</h3><p>Click a device on the map.</p>";
    return;
  }
  const silent = d.status === "DOWN" || d.status === "UNREACHABLE";
  const latency = silent || d.latency === null ? "-" : d.latency + " ms";
  const seen = d.last_seen ? new Date(d.last_seen * 1000).toLocaleTimeString() : "never";
  const up = uptime[d.id] !== undefined ? uptime[d.id] : 100;

  box.innerHTML = `
    <h3>${d.id} (${d.type})</h3>
    <p><b>IP:</b> ${d.ip}</p>
    <p><b>Status:</b> ${d.status}</p>
    <p><b>Latency:</b> ${latency}</p>
    <p><b>Uptime:</b> ${up}%</p>
    <p><b>Missed pings:</b> ${d.misses}</p>
    <p><b>Last seen:</b> ${seen}</p>
    ${latencyGraph(history)}
    <button onclick="act('fail')">Simulate failure</button>
    <button onclick="act('slow')">Make slow</button>
    <button onclick="act('restore')">Restore</button>`;
}

// ---------- event log ----------

function drawLog(events) {
  const log = document.getElementById("log");
  log.innerHTML = events.map(e => {
    const t = new Date(e.time * 1000).toLocaleTimeString();
    return `<li class="s-${e.new}">${t}: <b>${e.device}</b> ${e.old} → ${e.new}</li>`;
  }).join("");
}

// ---------- buttons ----------

async function act(action) {
  await fetch(`/api/${action}/${selectedId}`, { method: "POST" });
  refresh();
}