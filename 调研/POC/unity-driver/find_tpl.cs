// 找出当前所有可见文字里包含关键字的（用于抓 Toast / 弹窗文案）
var key = "__KEY__"; var sb = new System.Text.StringBuilder();
foreach (var t in UnityEngine.Object.FindObjectsOfType<UnityEngine.UI.Text>()) if (t.isActiveAndEnabled && t.text.Contains(key)) sb.Append(t.transform.parent.name + "/" + t.name + ": " + t.text.Replace("\n"," ") + "\n");
foreach (var t in UnityEngine.Object.FindObjectsOfType<TMPro.TMP_Text>()) if (t.isActiveAndEnabled && t.text.Contains(key)) sb.Append(t.transform.parent.name + "/" + t.name + ": " + t.text.Replace("\n"," ") + "\n");
return sb.Length == 0 ? "无" : sb.ToString();
