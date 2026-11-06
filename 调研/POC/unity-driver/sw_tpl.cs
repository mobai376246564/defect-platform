// 读取 / 点击自定义 Switch：__MODE__ = read 或 click
var basePath = "__BASE__";
var names = new string[] { __NAMES__ };
var sb = new System.Text.StringBuilder();
foreach (var n in names)
{
    var go = UnityEngine.GameObject.Find(basePath + "/" + n + "/Switch");
    if (go == null) { sb.Append(n + ": 不存在或已隐藏\n"); continue; }
    var sw = go.GetComponent("Switch");
    var ty = sw.GetType(); string state = "?";
    foreach (var pn in new string[] { "IsOn", "isOn", "On", "Value", "value" })
    {
        var pi = ty.GetProperty(pn, System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance);
        if (pi != null && pi.PropertyType == typeof(bool)) { state = pi.GetValue(sw, null).ToString(); break; }
        var fi = ty.GetField(pn, System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance);
        if (fi == null) fi = ty.GetField("_" + pn, System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance);
        if (fi != null && fi.FieldType == typeof(bool)) { state = fi.GetValue(sw).ToString(); break; }
    }
    if ("__MODE__" == "click")
    {
        var es = UnityEngine.EventSystems.EventSystem.current;
        var rt = go.GetComponent<UnityEngine.RectTransform>();
        var cv = go.GetComponentInParent<UnityEngine.Canvas>().rootCanvas;
        var cam = cv.renderMode == UnityEngine.RenderMode.ScreenSpaceOverlay ? null : cv.worldCamera;
        var c4 = new UnityEngine.Vector3[4]; rt.GetWorldCorners(c4);
        var sp = UnityEngine.RectTransformUtility.WorldToScreenPoint(cam, (c4[0] + c4[2]) / 2f);
        var ped = new UnityEngine.EventSystems.PointerEventData(es) { position = sp };
        var res = new System.Collections.Generic.List<UnityEngine.EventSystems.RaycastResult>(); es.RaycastAll(ped, res);
        if (res.Count == 0) { sb.Append(n + ": 射线未命中\n"); continue; }
        var h = UnityEngine.EventSystems.ExecuteEvents.GetEventHandler<UnityEngine.EventSystems.IPointerClickHandler>(res[0].gameObject);
        ped.pointerPressRaycast = res[0]; ped.pointerCurrentRaycast = res[0];
        UnityEngine.EventSystems.ExecuteEvents.Execute(h, ped, UnityEngine.EventSystems.ExecuteEvents.pointerDownHandler);
        UnityEngine.EventSystems.ExecuteEvents.Execute(h, ped, UnityEngine.EventSystems.ExecuteEvents.pointerUpHandler);
        UnityEngine.EventSystems.ExecuteEvents.Execute(h, ped, UnityEngine.EventSystems.ExecuteEvents.pointerClickHandler);
        sb.Append(n + ": 点击前=" + state + "，点到 " + (h != null ? h.name : res[0].gameObject.name) + "\n");
    }
    else
    {
        var fields = new System.Collections.Generic.List<string>();
        foreach (var f in ty.GetFields(System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance)) if (f.FieldType == typeof(bool)) fields.Add(f.Name + "=" + f.GetValue(sw));
        sb.Append(n + ": 状态=" + state + " 字段[" + string.Join(",", fields.ToArray()) + "]\n");
    }
}
return sb.ToString();
