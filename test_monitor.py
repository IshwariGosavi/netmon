from monitor import *

devices = load_devices()

def tick(n=1):
    for _ in range(n):
        for e in update_all(devices, simulated_probe):
            print("EVENT:", e["device"], e["old"], "->", e["new"])
    print({i: d["status"] for i, d in devices.items()})

tick()                 # everything healthy
failed.add("SW1")
tick(2)                # not enough misses yet
tick(1)                # third miss
failed.discard("SW1")
tick(1)                # recovery