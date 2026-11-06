// 打印某节点下的层级：名字、是否激活、组件、文字
var root = UnityEngine.GameObject.Find("__PATH__");
if (root == null) return "找不到节点";
var sb = new System.Text.StringBuilder();
System.Action<UnityEngine.Transform, int> walk = null;
walk = (t, d) => {
    if (d > __DEPTH__) return;
    var comps = new System.Collections.Generic.List<string>();
    foreach (var c in t.GetComponents<UnityEngine.Component>()) { var n = c.GetType().Name; if (n != "RectTransform" && n != "CanvasRenderer" && n != "Image" && n != "LayoutElement") comps.Add(n); }
    var tx = t.GetComponent<TMPro.TMP_Text>(); var tu = t.GetComponent<UnityEngine.UI.Text>();
    var s = tx != null ? tx.text : (tu != null ? tu.text : "");
    sb.Append(new string(' ', d * 2) + (t.gameObject.activeInHierarchy ? "" : "[隐] ") + t.name + " {" + string.Join(",", comps.ToArray()) + "} " + s.Replace("\n", " ") + "\n");
    foreach (UnityEngine.Transform ch in t) walk(ch, d + 1);
};
walk(root.transform, 0);
return sb.ToString();
