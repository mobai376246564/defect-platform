"""POC 驱动：python u.py click <文字或路径后缀> [序号] | ui | shot [名字] | console | wait <秒>"""
import subprocess, sys, time, os, glob
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
D = os.path.dirname(os.path.abspath(__file__))
def code(src, n=8000):
    p = os.path.join(D, "_tmp.cs"); open(p, "w", encoding="utf-8").write(src)
    r = subprocess.run([sys.executable, "-I", os.path.join(D, "umcp.py"), "code", p, str(n)], capture_output=True, text=True, encoding="utf-8")
    return (r.stdout + r.stderr).strip()
cmd = sys.argv[1]
if cmd == "click":
    t = open(os.path.join(D, "click_tpl.cs"), encoding="utf-8").read()
    t = t.replace("__KEY__", sys.argv[2].replace('"', '\\"')).replace("__NTH__", sys.argv[3] if len(sys.argv) > 3 else "0")
    print(code(t, 600)); time.sleep(1.5)
elif cmd == "ui":
    print(code(open(os.path.join(D, "ui.cs"), encoding="utf-8").read(), 12000))
elif cmd == "shot":
    name = sys.argv[2] if len(sys.argv) > 2 else time.strftime("%H%M%S")
    png = os.path.join(D, "../截图", name + ".png").replace("\\", "\\\\")
    print(code('UnityEngine.ScreenCapture.CaptureScreenshot("%s"); return "ok";' % png, 300))
    time.sleep(2)
    from PIL import Image
    src = png.replace("\\\\", "\\")
    im = Image.open(src).convert("RGB"); im.thumbnail((480, 854)); out = src[:-4] + ".jpg"; im.save(out, quality=80); os.remove(src)
    print(out)
elif cmd == "wait":
    time.sleep(float(sys.argv[2]))
