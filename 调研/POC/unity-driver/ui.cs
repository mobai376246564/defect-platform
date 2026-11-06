// 列出当前激活的可点击 UGUI 元素和可见文字（用于定位按钮）
var sb = new System.Text.StringBuilder();
sb.Append("playing=" + UnityEditor.EditorApplication.isPlaying + "\n");
foreach (var b in UnityEngine.Object.FindObjectsOfType<UnityEngine.UI.Selectable>())
{
    if (!b.isActiveAndEnabled) continue;
    var t = b.transform; var p = t.name; while (t.parent != null && p.Length < 160) { t = t.parent; p = t.name + "/" + p; }
    var txt = "";
    var root = b.transform;
    for (int k = 0; k < 2 && txt == ""; k++) {
        foreach (var tm in root.GetComponentsInChildren<TMPro.TMP_Text>()) if (tm.isActiveAndEnabled && tm.text.Trim() != "") txt += tm.text.Trim() + " / ";
        foreach (var tu in root.GetComponentsInChildren<UnityEngine.UI.Text>()) if (tu.isActiveAndEnabled && tu.text.Trim() != "") txt += tu.text.Trim() + " / ";
        if (root.parent != null) root = root.parent;
    }
    sb.Append(b.GetType().Name + " | " + p + " | " + txt.Replace("\n"," ") + "\n");
}
return sb.ToString();
