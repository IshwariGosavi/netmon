import json
import platform
import random
import re
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor

MISS_LIMIT = 3          # missed pings in a row before a device counts as silent
LATENCY_LIMIT_MS = 100  # replies slower than this = DEGRADED


def load_devices(path="topology.json"):
    with open(path) as f:
        raw = json.load(f)["devices"]
    devices = {}
    for d in raw:
        devices[d["id"]] = {
            **d,               # id, type, ip, parent
            "status": "UP",
            "misses": 0,
            "latency": None,
            "last_seen": None,
        }
    return devices


failed = set()   # devices we've "broken" from the dashboard (simulation mode only)
slow = set()     # devices we've made slow (simulation mode only)


def ancestors(devices, dev_id):
    chain = []
    parent = devices[dev_id]["parent"]
    while parent is not None:
        chain.append(parent)
        parent = devices[parent]["parent"]
    return chain


# ---------- probes: each returns latency in ms, or None if no reply ----------

def simulated_probe(devices, dev_id):
    path = [dev_id] + ancestors(devices, dev_id)
    if any(p in failed for p in path):
        return None                       # no reply
    if dev_id in slow:
        return 180                        # replies, but slowly
    return random.randint(2, 30)          # healthy


def real_probe(devices, dev_id):
    """Send one real ping to the device's IP."""
    ip = devices[dev_id]["ip"]
    if platform.system() == "Windows":
        cmd = ["ping", "-n", "1", "-w", "1000", ip]
    else:
        cmd = ["ping", "-c", "1", "-W", "1", ip]
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=4).stdout
    except (subprocess.TimeoutExpired, OSError):
        return None
    out = out.lower()
    # A real reply always contains "ttl=". Messages like "destination host
    # unreachable" do not, even though ping may still exit "successfully".
    if "ttl=" not in out:
        return None
    m = re.search(r"time[=<]\s*([\d.]+)\s*ms", out)
    return max(1, int(float(m.group(1)))) if m else 1


# ---------- detection logic ----------

def classify(devices, dev):
    if dev["misses"] >= MISS_LIMIT:
        # silent device: is it the real culprit or just a victim?
        for a in ancestors(devices, dev["id"]):
            if devices[a]["misses"] >= MISS_LIMIT:
                return "UNREACHABLE"      # something above it is also dead
        return "DOWN"                     # nothing above it is dead, so this is the root cause
    if dev["latency"] is not None and dev["latency"] > LATENCY_LIMIT_MS:
        return "DEGRADED"
    return "UP"


def update_all(devices, probe):
    # 1. probe every device at the same time (so one slow timeout doesn't hold up the rest)
    ids = list(devices.keys())
    with ThreadPoolExecutor(max_workers=len(ids) or 1) as pool:
        results = list(pool.map(lambda i: probe(devices, i), ids))

    # 2. update each device's counters
    for dev_id, latency in zip(ids, results):
        dev = devices[dev_id]
        if latency is None:
            dev["misses"] += 1
        else:
            dev["misses"] = 0
            dev["latency"] = latency
            dev["last_seen"] = time.time()

    # 3. decide each device's status; record any change as an event
    events = []
    for dev in devices.values():
        new = classify(devices, dev)
        if new != dev["status"]:
            events.append({"device": dev["id"], "old": dev["status"],
                           "new": new, "time": time.time()})
            dev["status"] = new
    return events