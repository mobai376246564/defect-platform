var s = UnityEngine.SceneManagement.SceneManager.GetActiveScene();
var names = new System.Collections.Generic.List<string>();
foreach (var x in UnityEditor.EditorBuildSettings.scenes) names.Add(x.path + (x.enabled ? "" : "(off)"));
return $"playing={UnityEditor.EditorApplication.isPlaying} compiling={UnityEditor.EditorApplication.isCompiling} scene={s.path} roots={s.rootCount} build=[{string.Join(", ", names)}]";
