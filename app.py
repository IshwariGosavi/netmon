import threading
import time
from flask import Flask, jsonify
import monitor
import db

app = Flask(__name__, static_folder="static", static_url_path="")
devices = monitor.load_devices()

def poll_loop():
       while True:
           changes = monitor.update_all(devices, monitor.simulated_probe)
           db.save_events(changes)
           db.save_checks(devices.values(), time.time())
           time.sleep(2)

@app.route("/")
def home():
    return app.send_static_file("index.html")

@app.route("/api/status")
def status():
    return jsonify(list(devices.values()))

@app.route("/api/events")
def get_events():
    return jsonify(db.get_events(50))

@app.route("/api/history/<dev_id>")
def history(dev_id):
    return jsonify(db.get_history(dev_id))

@app.route("/api/uptime")
def uptime():
    return jsonify({d: db.get_uptime(d) for d in devices})

@app.route("/api/fail/<dev_id>", methods=["POST"])
def fail(dev_id):
    if dev_id not in devices:
        return jsonify(error="unknown device"), 404
    monitor.failed.add(dev_id)
    return jsonify(ok=True)

@app.route("/api/restore/<dev_id>", methods=["POST"])
def restore(dev_id):
    monitor.failed.discard(dev_id)
    monitor.slow.discard(dev_id)
    return jsonify(ok=True)

@app.route("/api/slow/<dev_id>", methods=["POST"])
def make_slow(dev_id):
    if dev_id not in devices:
        return jsonify(error="unknown device"), 404
    monitor.slow.add(dev_id)
    return jsonify(ok=True)

if __name__ == "__main__":
    db.init_db()
    threading.Thread(target=poll_loop, daemon=True).start()
    app.run(debug=False)