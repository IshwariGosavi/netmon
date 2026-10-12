import { useEffect, useState } from "react";

// ---------- Helpers ----------
const STATUS = {
  UP: { label: "Up", color: "var(--up)", soft: "var(--up-soft)" },
  DEGRADED: { label: "Degraded", color: "var(--degraded)", soft: "var(--degraded-soft)" },
  DOWN: { label: "Down", color: "var(--down)", soft: "var(--down-soft)" },
  UNREACHABLE: { label: "Unreachable", color: "var(--unreachable)", soft: "var(--unreachable-soft)" },
};

const TYPE_LABEL = { router: "Router", switch: "Switch", server: "Server", pc: "PC" };

const fmtTime = (ts) =>
  new Date(ts * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });

const isSilent = (d) => d.status === "DOWN" || d.status === "UNREACHABLE";

// Place devices as a tree from their `parent` field, so a changed topology.json still lays out correctly.
function layoutTree(devices, width = 760, rowGap = 118, top = 40) {
  const kids = {};
  devices.forEach((d) => (kids[d.parent ?? "root"] ??= []).push(d.id));
  const leaves = devices.filter((d) => !kids[d.id]).length || 1;
  const pos = {};
  let leaf = 0;
  let maxDepth = 0;

  const place = (id, depth) => {
    const children = kids[id] ?? [];
    let x;
    if (!children.length) {
      x = ((leaf++ + 0.5) * width) / leaves;
    } else {
      children.forEach((c) => place(c, depth + 1));
      x = (pos[children[0]].x + pos[children[children.length - 1]].x) / 2;
    }
    maxDepth = Math.max(maxDepth, depth);
    pos[id] = { x, y: top + depth * rowGap };
  };
  (kids.root ?? []).forEach((r) => place(r, 0));
  return { pos, height: top + maxDepth * rowGap + 70 };
}

// ---------- Data loading (polls the Flask API every 2 seconds) ----------
const get = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  return res.json();
};

// Polls the Flask API every 2 seconds. `refresh()` forces an immediate reload (used after a button action).
function useDashboard(selectedId) {
  const [data, setData] = useState({ devices: [], events: [], uptime: {}, loaded: false, error: false, updated: null });
  const [history, setHistory] = useState({ id: null, rows: [] });
  const [kick, setKick] = useState(0);

  useEffect(() => {
    let live = true;
    async function load() {
      try {
        const [devices, events, uptime, rows] = await Promise.all([
          get("/api/status"),
          get("/api/events"),
          get("/api/uptime"),
          selectedId ? get("/api/history/" + selectedId) : [],
        ]);
        if (!live) return;
        setData({ devices, events, uptime, loaded: true, error: false, updated: Date.now() / 1000 });
        setHistory({ id: selectedId, rows });
      } catch {
        if (live) setData((d) => ({ ...d, loaded: true, error: true }));
      }
    }
    load();
    const timer = setInterval(load, 2000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [selectedId, kick]);

  return { ...data, history, refresh: () => setKick((n) => n + 1) };
}

// ---------- Status badge ----------
function StatusBadge({ status }) {
  const s = STATUS[status];
  if (!s) return null;
  return (
    <span className="badge" style={{ background: s.soft, color: s.color }}>
      <i style={{ background: s.color }} />
      {s.label}
    </span>
  );
}

// ---------- Alert banner ----------
function Banner({ devices, error, loaded }) {
  if (!loaded) return null;
  const down = devices.filter((d) => d.status === "DOWN");
  const unreachable = devices.filter((d) => d.status === "UNREACHABLE");
  const slow = devices.filter((d) => d.status === "DEGRADED");
  const names = (list) => list.map((d) => <b key={d.id}>{d.id} </b>);

  let tone = "ok";
  let body = "All devices are responding normally.";

  if (error) {
    tone = "down";
    body = "Can't reach the monitoring server. Retrying every 2 seconds.";
  } else if (down.length) {
    tone = "down";
    body = (
      <>
        {names(down)}
        {down.length === 1 ? "is" : "are"} down.
        {unreachable.length > 0 &&
          ` ${unreachable.length} ${unreachable.length === 1 ? "device is" : "devices are"} unreachable as a result.`}
      </>
    );
  } else if (slow.length) {
    tone = "warn";
    body = (
      <>
        {names(slow)}
        {slow.length === 1 ? "is" : "are"} responding slowly.
      </>
    );
  }

  return (
    <div className={"banner " + tone} role="status">
      {body}
    </div>
  );
}

// ---------- Summary cards ----------
function Stats({ devices, uptime }) {
  const count = (s) => devices.filter((d) => d.status === s).length;
  const values = devices.map((d) => uptime[d.id]).filter((v) => typeof v === "number");
  const avg = values.length ? (values.reduce((a, b) => a + b, 0) / values.length).toFixed(1) : "–";

  const cards = [
    { label: "Total devices", value: devices.length },
    { label: "Up", value: count("UP"), color: "var(--up)" },
    { label: "Degraded", value: count("DEGRADED"), color: "var(--degraded)" },
    { label: "Down", value: count("DOWN"), color: "var(--down)" },
    { label: "Unreachable", value: count("UNREACHABLE"), color: "var(--unreachable)" },
    { label: "Avg. uptime", value: avg, unit: values.length ? "%" : "" },
  ];

  return (
    <section className="stats" aria-label="Summary">
      {cards.map((c) => (
        <div className="card stat" key={c.label}>
          <div className="stat-label">
            {c.color && <i className="dot" style={{ background: c.color }} />}
            {c.label}
          </div>
          <div className="stat-value">
            {c.value}
            {c.unit && <small>{c.unit}</small>}
          </div>
        </div>
      ))}
    </section>
  );
}

// ---------- Network topology map ----------
const MAP_W = 760;

function Topology({ devices, selectedId, onSelect }) {
  const { pos, height } = layoutTree(devices, MAP_W);

  return (
    <section className="card">
      <h2>Network topology</h2>
      <svg viewBox={`0 0 ${MAP_W} ${height}`} className="map" role="group" aria-label="Network topology">
        {devices.map((d) => {
          const a = pos[d.parent];
          const b = pos[d.id];
          if (!a || !b) return null;
          const broken = isSilent(d);
          return (
            <line
              key={d.id}
              x1={a.x} y1={a.y} x2={b.x} y2={b.y}
              stroke={broken ? "var(--down)" : "var(--line)"}
              strokeWidth="2"
              strokeDasharray={broken ? "6 5" : undefined}
            />
          );
        })}

        {devices.map((d) => {
          const p = pos[d.id];
          if (!p) return null;
          const color = STATUS[d.status].color;
          const on = d.id === selectedId;
          const pick = () => onSelect(d.id);
          return (
            <g
              key={d.id}
              className={"node" + (on ? " on" : "")}
              transform={`translate(${p.x} ${p.y})`}
              tabIndex={0}
              role="button"
              aria-pressed={on}
              aria-label={`${d.id}, ${STATUS[d.status].label}`}
              onClick={pick}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), pick())}
            >
              <circle className="sel" r="30" />
              <circle r="22" fill="#fff" stroke={color} strokeWidth="2.5" />
              <circle r="6" fill={color} />
              <text y="46" className="n-id">{d.id}</text>
              <text y="61" className="n-ip">{d.ip}</text>
            </g>
          );
        })}
      </svg>

      <ul className="legend">
        {Object.values(STATUS).map((s) => (
          <li key={s.label}>
            <i className="dot" style={{ background: s.color }} />
            {s.label}
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------- Latency chart ----------
const W = 380, H = 190;
const M = { l: 42, r: 8, t: 10, b: 24 };
const MAX = 200, LIMIT = 100;

function LatencyChart({ rows }) {
  if (rows.length < 2) return <p className="muted pad">Collecting data…</p>;

  const iw = W - M.l - M.r, ih = H - M.t - M.b;
  const x = (i) => M.l + (i / (rows.length - 1)) * iw;
  const y = (ms) => M.t + ih - (Math.min(ms, MAX) / MAX) * ih;

  let line = "", area = "", missed = [], run = [];
  const flush = () => {
    if (run.length > 1) area += `M${run[0][0]} ${y(0)} ` + run.map(([px, py]) => `L${px} ${py}`).join(" ") + ` L${run.at(-1)[0]} ${y(0)} Z `;
    run = [];
  };
  rows.forEach((r, i) => {
    if (r.latency === null) {
      missed.push(x(i));
      flush();
    } else {
      const pt = [x(i).toFixed(1), y(r.latency).toFixed(1)];
      line += (run.length ? "L" : "M") + pt.join(" ") + " ";
      run.push(pt);
    }
  });
  flush();

  const ticks = [0, 50, 100, 150, 200];
  const labels = [0, Math.floor((rows.length - 1) / 2), rows.length - 1];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Latency of the most recent checks">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={M.l} x2={W - M.r} y1={y(t)} y2={y(t)} stroke="var(--grid)" />
          <text x={M.l - 8} y={y(t) + 4} textAnchor="end" className="axis">{t} ms</text>
        </g>
      ))}
      <line x1={M.l} x2={W - M.r} y1={y(LIMIT)} y2={y(LIMIT)} stroke="var(--degraded)" strokeDasharray="4 4" />
      <text x={W - M.r} y={y(LIMIT) - 5} textAnchor="end" className="axis warn">100 ms limit</text>

      <path d={area} fill="var(--accent)" opacity="0.08" />
      <path d={line} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {missed.map((px) => (
        <circle key={px} cx={px} cy={y(0)} r="3.5" fill="var(--down)" />
      ))}

      {labels.map((i, k) => (
        <text key={i} x={x(i)} y={H - 6} className="axis" textAnchor={k === 0 ? "start" : k === 2 ? "end" : "middle"}>
          {fmtTime(rows[i].time)}
        </text>
      ))}
    </svg>
  );
}

// ---------- Device details panel ----------
function DevicePanel({ device, uptime, history, onChanged }) {
  const [busy, setBusy] = useState(null);

  if (!device) {
    return (
      <section className="card panel">
        <h2>Device details</h2>
        <p className="muted">Select a device on the map to see its latency and run tests.</p>
      </section>
    );
  }

  async function act(kind) {
    setBusy(kind);
    try {
      await fetch(`/api/${kind}/${device.id}`, { method: "POST" });
      onChanged();
    } finally {
      setBusy(null);
    }
  }

  const info = [
    ["IP address", <span className="mono">{device.ip}</span>],
    ["Latency", isSilent(device) || device.latency === null ? "–" : `${device.latency} ms`],
    ["Uptime", `${uptime ?? 100}%`],
    ["Missed pings", device.misses],
    ["Parent", device.parent ?? "None"],
    ["Last seen", device.last_seen ? fmtTime(device.last_seen) : "Never"],
  ];

  return (
    <section className="card panel">
      <div className="panel-head">
        <div>
          <h2 className="device-name">{device.id}</h2>
          <p className="muted">{TYPE_LABEL[device.type] ?? device.type}</p>
        </div>
        <StatusBadge status={device.status} />
      </div>

      <dl className="info">
        {info.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>

      <h3>Latency, recent checks</h3>
      <LatencyChart rows={history} />

      <div className="actions">
        {[
          ["fail", "Simulate failure"],
          ["slow", "Make slow"],
          ["restore", "Restore"],
        ].map(([kind, label]) => (
          <button key={kind} className="btn" disabled={busy !== null} onClick={() => act(kind)}>
            {label}
          </button>
        ))}
      </div>
    </section>
  );
}

// ---------- Recent events table ----------
function Events({ events }) {
  return (
    <section className="card">
      <h2>Recent events</h2>
      {events.length === 0 ? (
        <p className="muted pad">No status changes yet. They'll appear here as soon as a device changes state.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Device</th>
                <th>Change</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e, i) => (
                <tr key={`${e.time}-${e.device}-${i}`}>
                  <td className="mono">{fmtTime(e.time)}</td>
                  <td><b>{e.device}</b></td>
                  <td>
                    <span className="change">
                      <StatusBadge status={e.old} />
                      <span className="arrow" aria-label="changed to">→</span>
                      <StatusBadge status={e.new} />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ---------- Page ----------
function App() {
  const [selectedId, setSelectedId] = useState(null);
  const { devices, events, uptime, history, loaded, error, updated, refresh } = useDashboard(selectedId);

  // Pick a device automatically on first load: the one that needs attention, otherwise the first.
  useEffect(() => {
    if (!selectedId && devices.length) {
      setSelectedId((devices.find((d) => d.status === "DOWN") ?? devices[0]).id);
    }
  }, [devices, selectedId]);

  const selected = devices.find((d) => d.id === selectedId);

  return (
    <div className="page">
      <header className="top">
        <div>
          <h1>Network monitor</h1>
          <p className="sub">Checks every device every 2 seconds</p>
        </div>
        <div className={"live" + (error ? " off" : "")}>
          <span className="dot" />
          {error ? "Disconnected" : updated ? `Updated ${fmtTime(updated)}` : "Connecting…"}
        </div>
      </header>

      <Banner devices={devices} error={error} loaded={loaded} />
      <Stats devices={devices} uptime={uptime} />

      <div className="split">
        <Topology devices={devices} selectedId={selectedId} onSelect={setSelectedId} />
        <DevicePanel
          device={selected}
          uptime={selected ? uptime[selected.id] : undefined}
          history={history.id === selectedId ? history.rows : []}
          onChanged={refresh}
        />
      </div>

      <Events events={events} />
    </div>
  );
}

export default App;