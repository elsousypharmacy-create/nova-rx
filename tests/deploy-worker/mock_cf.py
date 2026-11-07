"""Tiny fake of the Cloudflare Workers API used to test .github/scripts/deploy_worker.sh locally."""
import json, sys, email, threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs

S = {"mode": "normal", "modified_on": "2026-11-07T01:57:40.398045Z", "script": b"", "puts": [],
     "settings": {"compatibility_date": "2024-09-23", "compatibility_flags": [], "usage_model": "standard",
                  "bindings": [{"name": "GEMINI_API_KEY", "type": "secret_text"},
                               {"name": "NOVA_SECRET_ENCRYPTION_KEY", "type": "secret_text"},
                               {"name": "NOVA_SECRETS_KV", "type": "kv_namespace", "namespace_id": "abc"}]}}
ACC, NAME = "acc1", "nova-rx-preview"

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def send(self, obj, code=200, raw=None):
        body = raw if raw is not None else json.dumps(obj).encode()
        self.send_response(code); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)
    def do_GET(self):
        u = urlparse(self.path); p = u.path
        if not self.headers.get("Authorization", "").startswith("Bearer "): return self.send({"success": False}, 401)
        if p == "/__state": return self.send({"mode": S["mode"], "puts": S["puts"], "size": len(S["script"]), "bindings": S["settings"]["bindings"]})
        if p == "/__mode": S["mode"] = parse_qs(u.query)["m"][0]; return self.send({"ok": True})
        if p == "/accounts": return self.send({"success": True, "result": [{"id": ACC}]})
        if p == f"/accounts/{ACC}/workers/scripts": return self.send({"success": True, "result": [{"id": NAME, "modified_on": S["modified_on"]}]})
        if p == f"/accounts/{ACC}/workers/scripts/{NAME}/settings": return self.send({"success": True, "result": S["settings"]})
        if p == f"/accounts/{ACC}/workers/scripts/{NAME}": return self.send(None, raw=S["script"])
        self.send({"success": False}, 404)
    def do_PUT(self):
        p = urlparse(self.path).path
        if p != f"/accounts/{ACC}/workers/scripts/{NAME}": return self.send({"success": False}, 404)
        n = int(self.headers["Content-Length"]); body = self.rfile.read(n)
        msg = email.message_from_bytes(b"Content-Type: " + self.headers["Content-Type"].encode() + b"\r\n\r\n" + body)
        parts = {pt.get_param("name", header="content-disposition"): pt.get_payload(decode=True) for pt in msg.get_payload()}
        meta = json.loads(parts["metadata"]); S["puts"].append(meta)
        if S["mode"] == "put_fail": return self.send({"success": False, "errors": [{"message": "boom"}]}, 400)
        S["script"] = parts["script"]
        if S["mode"] == "drop_bindings" and S["puts"].__len__() == 1: S["settings"]["bindings"] = [b for b in S["settings"]["bindings"] if b["type"] != "kv_namespace"]
        if S["mode"] == "truncate" and S["puts"].__len__() == 1: S["script"] = S["script"][: len(S["script"]) // 2]
        S["modified_on"] = "2026-11-07T12:00:00.000000Z"
        self.send({"success": True, "result": {"modified_on": S["modified_on"], "etag": "etag-%d" % len(S["puts"])}})

if __name__ == "__main__":
    S["script"] = open(sys.argv[2], "rb").read()
    HTTPServer(("127.0.0.1", int(sys.argv[1])), H).serve_forever()
