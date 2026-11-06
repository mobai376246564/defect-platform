"""安卓真机纯视觉驱动（POC）：
python d.py shot <名字>        截图并缩到 0.4 倍（看图坐标 ×2.5 = 手机坐标）
python d.py tap <x> <y>        按缩略图坐标点击
python d.py swipe x1 y1 x2 y2 [ms]
python d.py key BACK|HOME|ENTER
python d.py text <ascii>       只能输 ASCII（adb input text 不支持中文）
python d.py logclear | log [关键字]   清空 / 读取 App 进程的 logcat（错误与 Unity 日志）
"""
import subprocess, sys, os, time
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ADB = [r"D:\Android\Sdk\platform-tools\adb.exe", "-s", "6HJDU19807040606"]
PKG = "com.pointone.androidBudBox"
K = 2.5  # 缩略图 → 手机像素的倍数
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "截图-真机")
def sh(*a, binary=False):
    r = subprocess.run(ADB + list(a), capture_output=True)
    return r.stdout if binary else r.stdout.decode("utf-8", "replace") + r.stderr.decode("utf-8", "replace")
c = sys.argv[1]
if c == "shot":
    from PIL import Image
    import io
    png = sh("exec-out", "screencap", "-p", binary=True)
    im = Image.open(io.BytesIO(png)).convert("RGB")
    im = im.resize((int(im.width / K), int(im.height / K)))
    if len(sys.argv) > 6:  # 可选裁剪区域（缩略图坐标），只看局部省 token
        im = im.crop(tuple(int(v) for v in sys.argv[3:7]))
    p = os.path.abspath(os.path.join(OUT, sys.argv[2] + ".jpg")); im.save(p, quality=80); print(p)
elif c == "tap":
    x, y = int(float(sys.argv[2]) * K), int(float(sys.argv[3]) * K)
    sh("shell", "input", "tap", str(x), str(y)); print("tap", x, y); time.sleep(1.5)
elif c == "swipe":
    a = [str(int(float(v) * K)) for v in sys.argv[2:6]]
    sh("shell", "input", "swipe", *a, sys.argv[6] if len(sys.argv) > 6 else "300"); time.sleep(1.2)
elif c == "key":
    sh("shell", "input", "keyevent", "KEYCODE_" + sys.argv[2]); time.sleep(1.2)
elif c == "text":
    print(sh("shell", "input", "text", sys.argv[2]))
elif c == "logclear":
    sh("logcat", "-c"); print("已清空")
elif c == "log":
    pid = sh("shell", "pidof", PKG).strip()
    out = sh("logcat", "-d", "-v", "time", "--pid", pid, "*:W") if pid else sh("logcat", "-d", "-v", "time", "*:E")
    ks = sys.argv[2:]
    lines = [l for l in out.splitlines() if not ks or any(k in l for k in ks)]
    print(f"pid={pid} 共 {len(lines)} 行"); print("\n".join(lines[-60:]))
