// 按可见文字或路径后缀找到按钮，在其屏幕中心做真实射线检测并派发点击（被弹窗遮住时点不到）
string key = "__KEY__"; int nth = __NTH__;
var es = UnityEngine.EventSystems.EventSystem.current;
if (es == null) return "无 EventSystem";
var hits = new System.Collections.Generic.List<UnityEngine.UI.Selectable>();
foreach (var b in UnityEngine.Object.FindObjectsOfType<UnityEngine.UI.Selectable>())
{
    if (!b.isActiveAndEnabled) continue;
    var t = b.transform; var p = t.name; while (t.parent != null) { t = t.parent; p = t.name + "/" + p; }
    var txt = "";
    var root = b.transform;
    for (int k = 0; k < 2 && txt == ""; k++) {
        foreach (var tm in root.GetComponentsInChildren<TMPro.TMP_Text>()) if (tm.isActiveAndEnabled && tm.text.Trim() != "") { txt = tm.text.Trim(); break; }
        if (txt == "") foreach (var tu in root.GetComponentsInChildren<UnityEngine.UI.Text>()) if (tu.isActiveAndEnabled && tu.text.Trim() != "") { txt = tu.text.Trim(); break; }
        if (root.parent != null) root = root.parent;
    }
    if (txt == key || txt.StartsWith(key + " ") || p.EndsWith(key)) hits.Add(b);
}
if (hits.Count <= nth) return "未找到：" + key + "（匹配 " + hits.Count + " 个）";
var target = hits[nth];
var rt = target.GetComponent<UnityEngine.RectTransform>();
// 在 ScrollRect 里时先把目标滚到视口中间（相当于用户先滑动列表）
var sr = target.GetComponentInParent<UnityEngine.UI.ScrollRect>();
if (sr != null && sr.content != null) {
    var vp = sr.viewport != null ? sr.viewport : (UnityEngine.RectTransform)sr.transform;
    var vc = new UnityEngine.Vector3[4]; vp.GetWorldCorners(vc);
    var tc = new UnityEngine.Vector3[4]; rt.GetWorldCorners(tc);
    float vMid = (vc[0].y + vc[1].y) / 2f, tMid = (tc[0].y + tc[1].y) / 2f;
    if (tc[0].y < vc[0].y || tc[1].y > vc[1].y) {
        var delta = sr.content.InverseTransformVector(new UnityEngine.Vector3(0, vMid - tMid, 0));
        sr.content.anchoredPosition += new UnityEngine.Vector2(0, delta.y);
        sr.velocity = UnityEngine.Vector2.zero;
        UnityEngine.Canvas.ForceUpdateCanvases();
    }
}
var canvas = target.GetComponentInParent<UnityEngine.Canvas>().rootCanvas;
var cam = canvas.renderMode == UnityEngine.RenderMode.ScreenSpaceOverlay ? null : canvas.worldCamera;
var corners = new UnityEngine.Vector3[4]; rt.GetWorldCorners(corners);
var center = (corners[0] + corners[2]) / 2f;
var sp = UnityEngine.RectTransformUtility.WorldToScreenPoint(cam, center);
var ped = new UnityEngine.EventSystems.PointerEventData(es) { position = sp };
var results = new System.Collections.Generic.List<UnityEngine.EventSystems.RaycastResult>();
es.RaycastAll(ped, results);
if (results.Count == 0) return "射线未命中任何物体 @" + sp;
var top = results[0].gameObject;
bool onTarget = top.transform.IsChildOf(target.transform);
ped.pointerPressRaycast = results[0]; ped.pointerCurrentRaycast = results[0];
var handler = UnityEngine.EventSystems.ExecuteEvents.GetEventHandler<UnityEngine.EventSystems.IPointerClickHandler>(top);
UnityEngine.EventSystems.ExecuteEvents.Execute(handler, ped, UnityEngine.EventSystems.ExecuteEvents.pointerDownHandler);
UnityEngine.EventSystems.ExecuteEvents.Execute(handler, ped, UnityEngine.EventSystems.ExecuteEvents.pointerUpHandler);
UnityEngine.EventSystems.ExecuteEvents.Execute(handler, ped, UnityEngine.EventSystems.ExecuteEvents.pointerClickHandler);
return (onTarget ? "已点击 " : "被遮挡，实际点到 ") + (handler != null ? handler.name : top.name) + " @" + sp;
