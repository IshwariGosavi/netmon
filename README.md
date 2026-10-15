# Network Failure Detection System

A Computer Networks course project. It checks every device in a network every 2 seconds, decides which devices have failed, finds the root cause of a failure, stores the history in a database, and shows everything on a live web dashboard.

The test network is built in **Cisco Packet Tracer**. The system can run in two modes:

- **Simulation mode:** monitors the Packet Tracer topology, with failures triggered from the dashboard.
- **Real mode:** sends real ping packets to real devices on a LAN.

---

## Contents

1. [How it works](#how-it-works)
2. [Tech stack](#tech-stack)
3. [Project structure](#project-structure)
4. [Setup](#setup)
5. [Running the project](#running-the-project)
6. [Simulation mode and real mode](#simulation-mode-and-real-mode)
7. [Cisco Packet Tracer setup](#cisco-packet-tracer-setup)
8. [API reference](#api-reference)
9. [Database](#database)
10. [Troubleshooting](#troubleshooting)
11. [Limitations and future work](#limitations-and-future-work)

---

## How it works

```
Devices  ->  Probe (ping)  ->  Detection logic  ->  MySQL  ->  Flask API  ->  React dashboard
```

Every 2 seconds the backend probes every device (all at the same time), updates each device's counters, classifies its status, saves the results to MySQL, and the dashboard reads them through the API.

### Detection logic (`monitor.py`)

1. **Probe:** each device is pinged. A reply resets its miss counter to 0 and records the latency. No reply adds 1 to the miss counter.
2. **Threshold:** a device is treated as silent only after **3 consecutive misses** (`MISS_LIMIT`). One lost packet is normal on any network, so waiting for three avoids false alarms. The cost is a delay of a few seconds before a failure shows.
3. **Four statuses:**

   | Status | Meaning |
   |---|---|
   | `UP` | Replying normally |
   | `DEGRADED` | Replying, but slower than 100 ms (`LATENCY_LIMIT_MS`) |
   | `DOWN` | Silent, and it is the **root cause** of the problem |
   | `UNREACHABLE` | Silent, but only because a device above it is also silent |

4. **Root-cause rule:** every device has a `parent`, the device it connects through. When a device is silent, its ancestors are checked. If any ancestor is also silent, the device is `UNREACHABLE` (a victim). If none is, the device is `DOWN` (the culprit).

   Example: if switch `SW1` fails, `PC1` and `PC2` stop replying too. The dashboard shows `SW1` as `DOWN` and `PC1`, `PC2` as `UNREACHABLE`, so the real fault is obvious.

5. **Events:** every status change is recorded as an event (device, old status, new status, time).

## Tech stack

| Tool | Role |
|---|---|
| Cisco Packet Tracer | Network simulation and failure tests |
| Python 3 | Detection logic and server |
| Flask | Background polling and REST API |
| MySQL | Stores events and check history |
| React + Vite | Live dashboard |
| VS Code | Code editor used for development |

## Project structure

```
netmon/
├── app.py                 # Flask server, polling thread, API, mode switch
├── monitor.py             # probes (simulated and real) and detection logic
├── db.py                  # all MySQL access
├── topology.json          # devices of the Packet Tracer network (simulation mode)
├── topology_real.json     # devices of a real network (real mode), edit the IPs
├── test_monitor.py        # optional: tests the detection logic without Flask
├── frontend/              # React source
│   ├── package.json
│   ├── vite.config.js
│   ├── index.html
│   └── src/
│       ├── App.jsx
│       ├── main.jsx
│       └── styles.css
└── static/                # built dashboard (output of `npm run build`), served by Flask
```

`vite.config.js` writes the production build into `../static`, so the `frontend` folder must sit inside `netmon`.

## Setup

### Requirements

- Python 3.9 or newer
- Node.js 18 or newer (only needed to build the dashboard)
- MySQL Server
- Cisco Packet Tracer (only for the network simulation)

### 1. Python environment

```bash
cd netmon
py -m venv venv            # use "python -m venv venv" if `python` works on your machine
venv\Scripts\Activate.ps1  # Windows PowerShell
pip install flask mysql-connector-python
```

On macOS or Linux, activate with `source venv/bin/activate`.

### 2. Database

In the MySQL command line client:

```sql
CREATE DATABASE IF NOT EXISTS netmon;
```

Then open `db.py` and set your MySQL password in `DB_CONFIG`:

```python
DB_CONFIG = {
    "host": "localhost",
    "user": "root",
    "password": "YOUR_PASSWORD",
    "database": "netmon",
}
```

The two tables are created automatically on first run. Do not commit your real password to a public repository.

### 3. Dashboard

```bash
cd frontend
npm install
npm run build
```

This creates `netmon/static`, which Flask serves.

## Running the project

```bash
cd netmon
venv\Scripts\Activate.ps1
python app.py
```

Open **http://localhost:5000**.

Stop the server with `Ctrl+C` in the same terminal. Closing a terminal tab does not always stop the server, and a leftover copy keeps port 5000 busy. If the dashboard ignores your actions, run `taskkill /F /IM python.exe` and start the app again.

For dashboard development, `npm run dev` (inside `frontend`) starts a dev server on port 5173 that forwards `/api` to Flask on port 5000. Run `npm run build` again before a demo so Flask serves the latest version.

## Simulation mode and real mode

Both modes use the same detection logic, database and dashboard. The only difference is the **probe**, the function that checks one device. Use the **Simulation / Real** switch in the dashboard header.

### Simulation mode (default)

- Topology: `topology.json`, the Packet Tracer network.
- The probe does not send any packet. It checks a list of devices marked as failed or slow from the dashboard, and returns a random healthy latency (2 to 30 ms) for the rest. A failed device also silences everything below it, as in a real network.
- Dashboard buttons **Simulate failure**, **Make slow** and **Restore** control the test.

Packet Tracer devices exist only inside Packet Tracer, so a PC cannot ping them. Simulation mode lets the same topology be monitored in a controlled, repeatable way.

### Real mode

- Topology: `topology_real.json`, which you must edit with your own IPs.
- The probe runs the operating system's `ping` command (one packet, 1 second timeout) against the device's IP. A reply (the output contains `TTL=`) counts as alive and gives the latency. Anything else counts as a miss.
- The test buttons are disabled. Failures come from the real network, for example a device being switched off or unplugged.

Setting up real mode:

1. Run `ipconfig` and copy the **Default Gateway**. Use it as the root (`parent: null`).
2. Add a few other devices on the same network (a classmate's PC, a phone) as children of the root, and optionally `8.8.8.8` as an internet target.
3. Test each IP by hand with `ping <ip>` before using it.
4. Or test them all with the same function the dashboard uses:

   ```bash
   python -c "import monitor; d=monitor.load_devices('topology_real.json'); [print(i, d[i]['ip'], monitor.real_probe(d,i)) for i in d]"
   ```

   A number is the latency in ms. `None` means no reply.

The file is read when you switch to Real mode, so switch to Simulation and back (or restart the server) after editing it.

## Cisco Packet Tracer setup

### Topology

```
                R1
          (2911 router)
          /            \
       SW1              SW2
   (2960 switch)    (2960 switch)
     /      \         /      \
   PC1      PC2     SRV      PC3
```

All links are copper straight-through cables.

### Addressing

| Device | IP address | Subnet mask | Default gateway |
|---|---|---|---|
| R1 (port towards SW1) | 192.168.1.1 | 255.255.255.0 | - |
| R1 (port towards SW2) | 192.168.2.1 | 255.255.255.0 | - |
| SW1 (VLAN 1) | 192.168.1.2 | 255.255.255.0 | 192.168.1.1 |
| SW2 (VLAN 1) | 192.168.2.2 | 255.255.255.0 | 192.168.2.1 |
| PC1 | 192.168.1.10 | 255.255.255.0 | 192.168.1.1 |
| PC2 | 192.168.1.11 | 255.255.255.0 | 192.168.1.1 |
| SRV | 192.168.2.10 | 255.255.255.0 | 192.168.2.1 |
| PC3 | 192.168.2.11 | 255.255.255.0 | 192.168.2.1 |

Check which router port each switch is plugged into (`show cdp neighbors`) and put each subnet's `.1` address on the matching port.

### Configuration commands

Router (use the interface names that match your cabling):

```
enable
configure terminal
hostname R1
interface gigabitEthernet0/0
ip address 192.168.1.1 255.255.255.0
no shutdown
exit
interface gigabitEthernet0/1
ip address 192.168.2.1 255.255.255.0
no shutdown
end
write memory
```

Switch (SW1 shown; SW2 uses `192.168.2.2` and gateway `192.168.2.1`):

```
enable
configure terminal
hostname SW1
interface vlan 1
ip address 192.168.1.2 255.255.255.0
no shutdown
exit
ip default-gateway 192.168.1.1
end
write memory
```

The switches get a management IP so the monitor has an address to ping.

### Failure tests

| Test | How to break it | What happens | Dashboard equivalent |
|---|---|---|---|
| Link failure | `shutdown` on the router port towards SW2 | The right side is cut off, the left side still works | Fail SW2 |
| Switch failure | Power off SW1 (Physical tab) | PC1 and PC2 lose everything | Fail SW1 |
| Router failure | `shutdown` on both router ports | Nothing crosses between the subnets | Fail R1 |

Restore with `no shutdown` or by powering the device back on. Use `ping 192.168.2.10` from PC1 to check connectivity across the router.

## API reference

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/status` | Current state of every device |
| GET | `/api/events` | Latest status changes (up to 50) for the current mode |
| GET | `/api/uptime` | Uptime percentage per device |
| GET | `/api/history/<id>` | Recent latency readings for one device |
| GET | `/api/mode` | Current mode (`sim` or `real`) |
| POST | `/api/mode/<sim\|real>` | Switch mode |
| POST | `/api/fail/<id>` | Mark a device as failed (simulation only) |
| POST | `/api/slow/<id>` | Make a device slow (simulation only) |
| POST | `/api/restore/<id>` | Clear failure and slowness (simulation only) |

Uptime counts a check as available when the status is `UP` or `DEGRADED`.

## Database

Two tables in the `netmon` database, created automatically by `db.init_db()`:

**`events`:** one row per status change

| Column | Type | Meaning |
|---|---|---|
| id | INT, auto increment | Primary key |
| device | VARCHAR(20) | Device id |
| old_status | VARCHAR(20) | Status before |
| new_status | VARCHAR(20) | Status after |
| ts | DOUBLE | Unix time of the change |

**`checks`:** one row per device per polling round

| Column | Type | Meaning |
|---|---|---|
| id | INT, auto increment | Primary key |
| device | VARCHAR(20) | Device id |
| status | VARCHAR(20) | Status at that moment |
| latency | INT, nullable | Latency in ms, empty when the ping was missed |
| ts | DOUBLE | Unix time of the check |

`checks` grows by one row per device every 2 seconds. A production system would delete old rows.

Useful queries:

```sql
USE netmon;
SELECT * FROM events ORDER BY id DESC LIMIT 20;
SELECT status, COUNT(*) FROM checks GROUP BY status;
TRUNCATE TABLE checks;   -- clear history before a demo
TRUNCATE TABLE events;
```

## Limitations and future work

- The dashboard does not read live data from Packet Tracer. It monitors the same topology in simulation mode, because Packet Tracer cannot feed an outside program and a PC cannot reach its devices.
- Ping-based detection cannot tell a dead device from a dead cable, because both mean "no reply". Interface status checks or SNMP traps would separate them.
- Devices that block ping appear as failed in real mode.
- Detection needs three missed checks, so a failure shows a few seconds after it happens. This is a deliberate trade-off against false alarms.
- Possible improvements: SNMP polling and traps, email or SMS alerts, automatic device discovery, authentication for the dashboard, and automatic clean-up of old history.
