"""最小 MCP（streamable HTTP）客户端：python umcp.py list | call <tool> '<json args>'"""
import json, sys, urllib.request
import sys as _s; _s.stdout.reconfigure(encoding="utf-8", errors="replace")
URL = "http://127.0.0.1:8080/mcp"
H = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream"}
def post(body, sid=None):
    h = dict(H)
    if sid: h["mcp-session-id"] = sid
    req = urllib.request.Request(URL, json.dumps(body).encode(), h)
    with urllib.request.urlopen(req, timeout=120) as r:
        sid = r.headers.get("mcp-session-id") or sid
        raw = r.read().decode("utf-8", "replace")
    msgs = []
    for line in raw.splitlines():
        if line.startswith("data:"):
            msgs.append(json.loads(line[5:]))
    if not msgs and raw.strip():
        msgs.append(json.loads(raw))
    return sid, msgs
sid, _ = post({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-03-26", "capabilities": {}, "clientInfo": {"name": "poc", "version": "0"}}})
post({"jsonrpc": "2.0", "method": "notifications/initialized"}, sid)
if sys.argv[1] == "list":
    _, m = post({"jsonrpc": "2.0", "id": 2, "method": "tools/list"}, sid)
    for t in m[-1]["result"]["tools"]:
        print(t["name"], "-", (t.get("description") or "").split("\n")[0][:150])
elif sys.argv[1] == "code":
    code = open(sys.argv[2], encoding="utf-8").read()
    _, m = post({"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": "execute_code", "arguments": {"action": "execute", "code": code}}}, sid)
    r = m[-1].get("result", m[-1])
    for c in r.get("content", []):
        print(c.get("text", "")[:int(sys.argv[3]) if len(sys.argv) > 3 else 8000])
else:
    args = json.loads(sys.argv[3]) if len(sys.argv) > 3 else {}
    _, m = post({"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": sys.argv[2], "arguments": args}}, sid)
    print(json.dumps(m[-1], ensure_ascii=False)[:int(sys.argv[4]) if len(sys.argv) > 4 else 6000])
