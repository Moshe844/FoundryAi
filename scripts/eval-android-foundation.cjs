const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const tls = require("node:tls");

async function main() {

const root = path.resolve(__dirname, "..");
const runtime = fs.readFileSync(path.join(root, "lib/factory/runtime.ts"), "utf8");
const sdkEvidence = fs.readFileSync(path.join(root, "lib/factory/android-sdk-evidence.ts"), "utf8");
assert.match(sdkEvidence, /replace\(\/\\\$\[\^\/\]\+/, "Android SDK evidence still omits nested public request/response classes.");
assert.match(sdkEvidence, /"-public", "-constants"/, "Android SDK evidence does not expose public constant values needed for real request construction.");
assert.match(runtime, /!\/<application\\b\/i[\s\S]{0,900}android\.intent\.category\.LAUNCHER/, "Android scaffold recovery does not repair a manifest missing its application and launcher activity.");
const executor = fs.readFileSync(path.join(root, "lib/ai/mission/executor.ts"), "utf8");
const languageAdapters = fs.readFileSync(path.join(root, "lib/factory/language-adapters.ts"), "utf8");
assert.match(languageAdapters, /jetpack\\s\+compose/, "Jetpack Compose stack choices must classify as Android without requiring the literal word Android.");
assert.ok(executor.includes("input.commandOnly && !input.newProject && !input.requireFirstMutation"), "Generated-project recovery must retain write_files even when a continuation was classified command-only.");
for (const contract of ["settings.gradle.kts", "app/build.gradle.kts", "AndroidManifest.xml", "FoundationTest.kt", "importedAar", "room-runtime:2.6.1", "compose-bom:2024.06.00"]) {
  assert.ok(runtime.includes(contract), `Android scaffold contract is missing ${contract}`);
}

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-android-foundation-"));
const project = path.join(sandbox, "project");
const bootstrap = path.join(sandbox, "wrapper-bootstrap");
const sdk = path.join(os.homedir(), "AppData", "Local", "Android", "Sdk");
const javaHome = "C:\\Program Files\\Android\\Android Studio\\jbr";
assert.ok(fs.existsSync(path.join(sdk, "platform-tools", "adb.exe")), "Android SDK platform-tools are missing.");
assert.ok(fs.existsSync(path.join(javaHome, "bin", "java.exe")), "Android Studio JDK is missing.");
const trustStore = path.join(os.tmpdir(), "foundry-gradle-truststore.p12");
if (!fs.existsSync(trustStore)) {
  fs.copyFileSync(path.join(javaHome, "lib", "security", "cacerts"), trustStore);
  const keytool = path.join(javaHome, "bin", "keytool.exe");
  for (const [index, certificate] of tls.getCACertificates("system").entries()) {
    const certificateFile = path.join(sandbox, `system-ca-${index}.pem`);
    fs.writeFileSync(certificateFile, certificate);
    const imported = spawnSync(keytool, ["-importcert", "-noprompt", "-trustcacerts", "-alias", `foundry-system-${index}`, "-file", certificateFile, "-keystore", trustStore, "-storepass", "changeit"], { encoding: "utf8" });
    assert.equal(imported.status, 0, imported.stderr || imported.stdout);
  }
}
const trustStoreProperty = trustStore.replace(/\\/g, "/");
const androidEnvironment = { ...process.env, JAVA_HOME: javaHome, ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk, GRADLE_OPTS: `${process.env.GRADLE_OPTS ?? ""} -Djavax.net.ssl.trustStore=${trustStoreProperty} -Djavax.net.ssl.trustStorePassword=changeit`.trim() };
const write = (name, content) => { const target = path.join(project, name); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, content); };
fs.mkdirSync(bootstrap, { recursive: true });
fs.writeFileSync(path.join(bootstrap, "settings.gradle"), "rootProject.name='wrapper-bootstrap'\n");
fs.writeFileSync(path.join(bootstrap, "build.gradle"), "\n");

const gradleRoot = path.join(os.homedir(), ".gradle", "wrapper", "dists");
const gradleBat = fs.existsSync(gradleRoot) ? (() => {
  const queue = [gradleRoot];
  while (queue.length) {
    const current = queue.shift();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) queue.push(full);
      else if (entry.name.toLowerCase() === "gradle.bat") return full;
    }
  }
})() : undefined;
assert.ok(gradleBat, "No cached Gradle distribution is available to create the wrapper.");
const distributionZip = path.join(os.tmpdir(), "foundry-gradle-8.7-bin.zip");
if (!fs.existsSync(distributionZip)) {
  const download = await fetch("https://services.gradle.org/distributions/gradle-8.7-bin.zip");
  assert.equal(download.ok, true, `Gradle distribution download returned HTTP ${download.status}.`);
  fs.writeFileSync(distributionZip, Buffer.from(await download.arrayBuffer()));
}
const localDistributionUrl = pathToFileURL(distributionZip).href;
const runBat = (file, args, options = {}) => spawnSync(file, args, { encoding: "utf8", shell: true, ...options });
const wrapper = runBat(gradleBat, ["-p", bootstrap, "wrapper", "--gradle-version", "8.7", "--gradle-distribution-url", localDistributionUrl], { timeout: 120_000, env: androidEnvironment });
assert.equal(wrapper.status, 0, `${wrapper.stdout}\n${wrapper.stderr}`);

write("settings.gradle.kts", "pluginManagement { repositories { google(); mavenCentral(); gradlePluginPortal() } }\ndependencyResolutionManagement { repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS); repositories { google(); mavenCentral() } }\nrootProject.name=\"FoundryAndroidFoundation\"\ninclude(\":app\")\n");
write("build.gradle.kts", "plugins { id(\"com.android.application\") version \"8.5.2\" apply false; id(\"org.jetbrains.kotlin.android\") version \"1.9.24\" apply false; id(\"com.google.devtools.ksp\") version \"1.9.24-1.0.20\" apply false }\n");
write("gradle.properties", "org.gradle.jvmargs=-Xmx3g -Dfile.encoding=UTF-8\nandroid.useAndroidX=true\nkotlin.code.style=official\n");
write("app/build.gradle.kts", "plugins { id(\"com.android.application\"); id(\"org.jetbrains.kotlin.android\"); id(\"com.google.devtools.ksp\") }\nandroid { namespace=\"com.foundry.foundation\"; compileSdk=35; defaultConfig { applicationId=\"com.foundry.foundation\"; minSdk=26; targetSdk=35; versionCode=1; versionName=\"1.0\"; testInstrumentationRunner=\"androidx.test.runner.AndroidJUnitRunner\" }; buildFeatures { compose=true }; composeOptions { kotlinCompilerExtensionVersion=\"1.5.14\" }; compileOptions { sourceCompatibility=JavaVersion.VERSION_17; targetCompatibility=JavaVersion.VERSION_17 }; kotlinOptions { jvmTarget=\"17\" } }\ndependencies { implementation(platform(\"androidx.compose:compose-bom:2024.06.00\")); implementation(\"androidx.activity:activity-compose:1.9.1\"); implementation(\"androidx.compose.material3:material3\"); implementation(\"androidx.room:room-runtime:2.6.1\"); implementation(\"androidx.room:room-ktx:2.6.1\"); ksp(\"androidx.room:room-compiler:2.6.1\"); testImplementation(\"junit:junit:4.13.2\") }\n");
write("app/src/main/AndroidManifest.xml", "<manifest xmlns:android=\"http://schemas.android.com/apk/res/android\"><application android:theme=\"@style/Theme.Foundry\"><activity android:name=\".MainActivity\" android:exported=\"true\"><intent-filter><action android:name=\"android.intent.action.MAIN\"/><category android:name=\"android.intent.category.LAUNCHER\"/></intent-filter></activity></application></manifest>\n");
write("app/src/main/res/values/styles.xml", "<resources><style name=\"Theme.Foundry\" parent=\"android:style/Theme.Material.Light.NoActionBar\"/></resources>\n");
write("app/src/main/java/com/foundry/foundation/MainActivity.kt", "package com.foundry.foundation\nimport android.os.Bundle\nimport androidx.activity.ComponentActivity\nimport androidx.activity.compose.setContent\nimport androidx.compose.material3.Text\nclass MainActivity:ComponentActivity(){override fun onCreate(savedInstanceState:Bundle?){super.onCreate(savedInstanceState);setContent{Text(\"Foundation ready\")}}}\n");
write("app/src/test/java/com/foundry/foundation/FoundationTest.kt", "package com.foundry.foundation\nimport org.junit.Assert.assertTrue\nimport org.junit.Test\nclass FoundationTest{@Test fun loads(){assertTrue(true)}}\n");

for (const name of ["gradlew", "gradlew.bat"]) fs.copyFileSync(path.join(bootstrap, name), path.join(project, name));
fs.cpSync(path.join(bootstrap, "gradle"), path.join(project, "gradle"), { recursive: true });
const wrapperProperties = path.join(project, "gradle", "wrapper", "gradle-wrapper.properties");
const wrapperConfig = fs.readFileSync(wrapperProperties, "utf8").replace(/^distributionUrl=.*$/m, `distributionUrl=${pathToFileURL(distributionZip).href.replace(/:/g, "\\:")}`);
fs.writeFileSync(wrapperProperties, wrapperConfig);
write("local.properties", `sdk.dir=${sdk.replace(/\\/g, "\\\\")}\n`);
const built = runBat(path.join(project, "gradlew.bat"), ["--no-daemon", "testDebugUnitTest", "assembleDebug"], { cwd: project, timeout: 600_000, env: androidEnvironment });
assert.equal(built.status, 0, `${built.stdout}\n${built.stderr}`);
assert.ok(fs.existsSync(path.join(project, "app", "build", "outputs", "apk", "debug", "app-debug.apk")), "Debug APK was not produced.");
console.log("Deterministic Android Gradle foundation built, unit-tested, and produced app-debug.apk.");
fs.rmSync(sandbox, { recursive: true, force: true });
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
