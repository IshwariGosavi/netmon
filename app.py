import threading
import time
from flask import Flask, jsonify
import monitor
import db

app = Flask(__name__, static_folder="static", static_url_path="")

# One topology file per mode
TOPOLOGIES = {
    "sim": "topology.json",         # the Packet Tracer network, with simulated probes
    "real": "topology_real.json",   # real devices on your own network, with real pings
}


def make_state(mode):
    return {"mode": mode, "devices": monitor.load_devices(TOPOLOGIES[mode])}


# mode and devices live together in one dict, so switching mode swaps both at once
state = make_state("sim")


def poll_loop():
    while True:
        s = state                                   # take one consistent snapshot
        probe = monitor.simulated_probe if s["mode"] == "sim" else monitor.real_probe
        changes = monitor.update_all(s["devices"], probe)
        db.save_events(changes)
        db.save_checks(s["devices"].values(), time.time())
        time.sleep(2)


@app.route("/")
def home():
    return app.send_static_file("index.html")


@app.route("/api/mode")
def get_mode():
    return jsonify(mode=state["mode"])


@app.route("/api/mode/<new_mode>", methods=["POST"])
def set_mode(new_mode):
    global state
    if new_mode not in TOPOLOGIES:
        return jsonify(error="mode must be 'sim' or 'real'"), 400
    try:
        new_state = make_state(new_mode)
    except FileNotFoundError:
        return jsonify(error=TOPOLOGIES[new_mode] + " not found in the project folder"), 400
    monitor.failed.clear()
    monitor.slow.clear()
    state = new_state
    return jsonify(mode=new_mode)


@app.route("/api/status")
def status():
    return jsonify(list(state["devices"].values()))


@app.route("/api/events")
def get_events():
    devs = state["devices"]
    recent = db.get_events(200)
    # only show events of devices in the current mode's topology
    return jsonify([e for e in recent if e["device"] in devs][:50])


@app.route("/api/history/<dev_id>")
def history(dev_id):
    return jsonify(db.get_history(dev_id))


@app.route("/api/uptime")
def uptime():
    return jsonify({d: db.get_uptime(d) for d in state["devices"]})


def _sim_only():
    if state["mode"] != "sim":
        return jsonify(error="Failures come from the real network in Real mode"), 400
    return None


@app.route("/api/fail/<dev_id>", methods=["POST"])
def fail(dev_id):
    blocked = _sim_only()
    if blocked:
        return blocked
    if dev_id not in state["devices"]:
        return jsonify(error="unknown device"), 404
    monitor.failed.add(dev_id)
    return jsonify(ok=True)


@app.route("/api/restore/<dev_id>", methods=["POST"])
def restore(dev_id):
    blocked = _sim_only()
    if blocked:
        return blocked
    monitor.failed.discard(dev_id)
    monitor.slow.discard(dev_id)
    return jsonify(ok=True)


@app.route("/api/slow/<dev_id>", methods=["POST"])
def make_slow(dev_id):
    blocked = _sim_only()
    if blocked:
        return blocked
    if dev_id not in state["devices"]:
        return jsonify(error="unknown device"), 404
    monitor.slow.add(dev_id)
    return jsonify(ok=True)


if __name__ == "__main__":
    db.init_db()
    threading.Thread(target=poll_loop, daemon=True).start()
    app.run(debug=False)