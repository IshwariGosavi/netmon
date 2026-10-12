import json
import random
import time

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

failed = set()   # devices we've "broken" from the dashboard
slow = set()     # devices we've made slow (to show DEGRADED)

def ancestors(devices, dev_id):
    chain = []
    parent = devices[dev_id]["parent"]
    while parent is not None:
        chain.append(parent)
        parent = devices[parent]["parent"]
    return chain

def simulated_probe(devices, dev_id):
    path = [dev_id] + ancestors(devices, dev_id)
    if any(p in failed for p in path):
        return None                       # no reply
    if dev_id in slow:
        return 180                        # replies, but slowly
    return random.randint(2, 30)          # healthy

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
    # 1. probe every device and update its counters
    for dev in devices.values():
        latency = probe(devices, dev["id"])
        if latency is None:
            dev["misses"] += 1
        else:
            dev["misses"] = 0
            dev["latency"] = latency
            dev["last_seen"] = time.time()

    # 2. decide each device's status; record any change as an event
    events = []
    for dev in devices.values():
        new = classify(devices, dev)
        if new != dev["status"]:
            events.append({"device": dev["id"], "old": dev["status"],
                           "new": new, "time": time.time()})
            dev["status"] = new
    return events
