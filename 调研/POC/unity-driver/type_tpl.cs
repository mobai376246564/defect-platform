// 往输入框写入文字（模拟用户输入），触发 onValueChanged
var go = UnityEngine.GameObject.Find("__PATH__");
if (go == null) return "找不到输入框";
var tmp = go.GetComponentInChildren<TMPro.TMP_InputField>();
if (tmp != null) { tmp.text = "__TEXT__"; tmp.onValueChanged.Invoke(tmp.text); return "TMP 已输入：" + tmp.text; }
var ui = go.GetComponentInChildren<UnityEngine.UI.InputField>();
if (ui != null) { ui.text = "__TEXT__"; ui.onValueChanged.Invoke(ui.text); return "InputField 已输入：" + ui.text; }
var comps = new System.Collections.Generic.List<string>(); foreach (var c in go.GetComponentsInChildren<UnityEngine.Component>()) comps.Add(c.GetType().Name);
return "没有标准输入组件：" + string.Join(",", comps.ToArray());
