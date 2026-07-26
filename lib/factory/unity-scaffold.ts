export function unityScaffoldFiles(projectName: string): Record<string, string> {
  const title = projectName.replace(/["\r\n]/g, " ").trim() || "Foundry Game";
  return {
    "ProjectSettings/ProjectVersion.txt": "m_EditorVersion: 2022.3.62f1\n",
    "Packages/manifest.json": `${JSON.stringify({
      dependencies: {
        "com.unity.collab-proxy": "2.4.3",
        "com.unity.ide.visualstudio": "2.0.22",
        "com.unity.test-framework": "1.1.33",
        "com.unity.ugui": "1.0.0",
      },
    }, null, 2)}\n`,
    "Assets/Foundry/Runtime/FoundryGameBootstrap.cs": `using UnityEngine;

namespace FoundryGame
{
    public static class FoundryGameBootstrap
    {
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        public static void CreatePlayableWorld()
        {
            if (GameObject.Find("Foundry Player") != null) return;

            var ground = GameObject.CreatePrimitive(PrimitiveType.Plane);
            ground.name = "Exploration Ground";
            ground.transform.localScale = new Vector3(8f, 1f, 8f);

            var player = GameObject.CreatePrimitive(PrimitiveType.Capsule);
            player.name = "Foundry Player";
            player.transform.position = new Vector3(0f, 1f, 0f);
            player.AddComponent<FoundryPlayerController>();

            var lightObject = new GameObject("Directional Light");
            var light = lightObject.AddComponent<Light>();
            light.type = LightType.Directional;
            light.intensity = 1.15f;
            lightObject.transform.rotation = Quaternion.Euler(45f, -30f, 0f);

            var cameraObject = new GameObject("Main Camera");
            cameraObject.tag = "MainCamera";
            var camera = cameraObject.AddComponent<Camera>();
            cameraObject.AddComponent<AudioListener>();
            camera.transform.position = new Vector3(0f, 7f, -10f);
            camera.transform.LookAt(player.transform);
            cameraObject.AddComponent<FoundryCameraFollow>().Target = player.transform;
        }
    }

    public sealed class FoundryPlayerController : MonoBehaviour
    {
        [SerializeField] private float speed = 6f;
        private void Update()
        {
            var movement = new Vector3(Input.GetAxisRaw("Horizontal"), 0f, Input.GetAxisRaw("Vertical")).normalized;
            transform.position += movement * speed * Time.deltaTime;
        }
    }

    public sealed class FoundryCameraFollow : MonoBehaviour
    {
        public Transform Target;
        private Vector3 offset;
        private void Start() { if (Target != null) offset = transform.position - Target.position; }
        private void LateUpdate()
        {
            if (Target == null) return;
            transform.position = Target.position + offset;
            transform.LookAt(Target);
        }
    }
}
`,
    "Assets/Foundry/Runtime/FoundryGame.Runtime.asmdef": `${JSON.stringify({ name: "FoundryGame.Runtime" }, null, 2)}\n`,
    "Assets/Foundry/Editor/Build.cs": `using System;
using System.IO;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

public static class Foundry
{
    private const string ScenePath = "Assets/Foundry/Scenes/Main.unity";

    [MenuItem("Foundry/Prepare Project")]
    public static void PrepareProject()
    {
        Directory.CreateDirectory("Assets/Foundry/Scenes");
        var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
        EditorSceneManager.SaveScene(scene, ScenePath);
        EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene(ScenePath, true) };
        PlayerSettings.productName = ${JSON.stringify(title)};
        AssetDatabase.SaveAssets();
    }

    [MenuItem("Foundry/Build")]
    public static void Build()
    {
        PrepareProject();
        var target = EditorUserBuildSettings.activeBuildTarget;
        var extension = target == BuildTarget.StandaloneWindows || target == BuildTarget.StandaloneWindows64 ? ".exe"
            : target == BuildTarget.StandaloneOSX ? ".app" : "";
        var output = Path.Combine("Builds", target.ToString(), ${JSON.stringify(title.replace(/[^a-zA-Z0-9_-]+/g, "-"))} + extension);
        Directory.CreateDirectory(Path.GetDirectoryName(output) ?? "Builds");
        var report = BuildPipeline.BuildPlayer(EditorBuildSettings.scenes, output, target, BuildOptions.None);
        if (report.summary.result != UnityEditor.Build.Reporting.BuildResult.Succeeded)
            throw new Exception("Unity build failed: " + report.summary.result);
    }
}
`,
    "Assets/Foundry/Tests/EditMode/FoundryFoundationTests.cs": `using NUnit.Framework;
using UnityEngine;

namespace FoundryGame.Tests
{
    public sealed class FoundryFoundationTests
    {
        [Test]
        public void BootstrapCreatesPlayablePlayer()
        {
            FoundryGameBootstrap.CreatePlayableWorld();
            Assert.IsNotNull(GameObject.Find("Foundry Player"));
            Object.DestroyImmediate(GameObject.Find("Foundry Player"));
            Object.DestroyImmediate(GameObject.Find("Exploration Ground"));
            Object.DestroyImmediate(GameObject.Find("Directional Light"));
            Object.DestroyImmediate(GameObject.Find("Main Camera"));
        }
    }
}
`,
    "Assets/Foundry/Tests/EditMode/FoundryGame.EditModeTests.asmdef": `${JSON.stringify({
      name: "FoundryGame.EditModeTests",
      references: ["FoundryGame.Runtime"],
      optionalUnityReferences: ["TestAssemblies"],
      includePlatforms: ["Editor"],
    }, null, 2)}\n`,
    ".gitignore": "[Ll]ibrary/\n[Tt]emp/\n[Oo]bj/\n[Bb]uild/\n[Bb]uilds/\n[Ll]ogs/\nUserSettings/\n*.csproj\n*.sln\n",
  };
}

export function validateUnityScaffold(files: Record<string, string>) {
  const required = [
    "ProjectSettings/ProjectVersion.txt",
    "Packages/manifest.json",
    "Assets/Foundry/Runtime/FoundryGameBootstrap.cs",
    "Assets/Foundry/Runtime/FoundryGame.Runtime.asmdef",
    "Assets/Foundry/Editor/Build.cs",
    "Assets/Foundry/Tests/EditMode/FoundryFoundationTests.cs",
    "Assets/Foundry/Tests/EditMode/FoundryGame.EditModeTests.asmdef",
  ];
  const missing = required.filter((file) => !files[file]?.trim());
  if (!files["Assets/Foundry/Editor/Build.cs"]?.includes("static class Foundry") || !files["Assets/Foundry/Editor/Build.cs"]?.includes("static void Build")) {
    missing.push("Foundry.Build entry point");
  }
  return { complete: missing.length === 0, missing };
}
