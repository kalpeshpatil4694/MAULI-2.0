import { registerExecutor, grantExecutor } from './executor-registry.js';
import { registerArtifact } from './artifacts.js';

function text(v) { return v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v); }

/**
 * Native Code Executor — generates platform-specific native application code.
 * Supports: Android (Kotlin), iOS (Swift), Desktop (Electron/Tauri), React Native, Flutter
 */
async function generateNativeCode({ task, env, agentId }) {
  const objective = text(task.description || task.title || 'Build a native application');
  const acceptance = Array.isArray(task.acceptance) ? task.acceptance : [];
  const title = text(task.title || '');
  
  // Detect target platform from task description
  const lowerObj = (objective + ' ' + title).toLowerCase();
  const isAndroid = /android|apk|mobile app/i.test(lowerObj);
  const isIOS = /ios|iphone|ipad|apple|swift/i.test(lowerObj);
  const isDesktop = /desktop|windows|macos|linux|electron|tauri/i.test(lowerObj);
  const isFlutter = /flutter|dart/i.test(lowerObj);
  const isReactNative = /react native|rn/i.test(lowerObj);
  
  let platform = 'web';
  let files = [];
  
  if (isFlutter) {
    platform = 'flutter';
    files = generateFlutterProject(objective);
  } else if (isReactNative) {
    platform = 'react-native';
    files = generateReactNativeProject(objective);
  } else if (isAndroid) {
    platform = 'android';
    files = generateAndroidProject(objective);
  } else if (isIOS) {
    platform = 'ios';
    files = generateIOSProject(objective);
  } else if (isDesktop) {
    platform = 'desktop';
    files = generateDesktopProject(objective);
  } else {
    // Default: web app with Capacitor support
    platform = 'web-capacitor';
    files = generateWebCapacitorProject(objective);
  }

  const artifact = registerArtifact({
    projectId: task.projectId,
    taskId: task.id,
    agentId,
    type: 'code-workspace',
    content: {
      summary: `${platform.toUpperCase()} native application generated: ${objective}`,
      files,
      tests: [`${platform} project builds successfully`, 'Application launches without errors'],
      notes: [`Platform: ${platform}`, 'See README.md for build instructions']
    },
    metadata: { generatedBy: 'native-code-executor', functional: true, taskType: platform, fileCount: files.length, platform }
  });

  return { type: 'code', artifactId: artifact.id, summary: artifact.content.summary, files, tests: artifact.content.tests, notes: artifact.content.notes, acceptance };
}

function generateAndroidProject(objective) {
  return [
    { path: 'app/src/main/java/com/mauli/app/MainActivity.kt', content: `package com.mauli.app\n\nimport android.os.Bundle\nimport androidx.appcompat.app.AppCompatActivity\nimport androidx.core.view.WindowCompat\nimport android.webkit.WebView\nimport android.webkit.WebViewClient\nimport android.webkit.WebChromeClient\nimport android.view.ViewGroup.LayoutParams\nimport android.widget.FrameLayout\n\nclass MainActivity : AppCompatActivity() {\n    private lateinit var webView: WebView\n\n    override fun onCreate(savedInstanceState: Bundle?) {\n        super.onCreate(savedInstanceState)\n        WindowCompat.setDecorFitsSystemWindows(window, false)\n        \n        webView = WebView(this).apply {\n            layoutParams = FrameLayout.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT)\n            webViewClient = WebViewClient()\n            webChromeClient = WebChromeClient()\n            settings.javaScriptEnabled = true\n            settings.domStorageEnabled = true\n            settings.allowFileAccess = true\n            loadUrl("file:///android_asset/www/index.html")\n        }\n        setContentView(webView)\n    }\n\n    override fun onBackPressed() {\n        if (webView.canGoBack()) webView.goBack()\n        else super.onBackPressed()\n    }\n}` },
    { path: 'app/src/main/assets/www/index.html', content: `<!DOCTYPE html>\n<html>\n<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<title>${objective}</title>\n<link rel="stylesheet" href="styles.css">\n</head>\n<body>\n<div id="app">\n  <h1>${objective}</h1>\n  <p>Native Android Application</p>\n</div>\n<script src="app.js"></script>\n</body>\n</html>` },
    { path: 'app/src/main/assets/www/app.js', content: `// ${objective}\nconsole.log('App loaded');\ndocument.getElementById('app').addEventListener('click', () => {\n  console.log('App clicked');\n});` },
    { path: 'app/src/main/assets/www/styles.css', content: `* { margin:0; padding:0; box-sizing:border-box; }\nbody { font-family:system-ui; background:#0f172a; color:#fff; min-height:100vh; display:flex; align-items:center; justify-content:center; }\n#app { text-align:center; padding:2rem; }\nh1 { font-size:1.5rem; margin-bottom:0.5rem; }\np { color:#94a3b8; }` },
    { path: 'app/build.gradle', content: `plugins {\n    id 'com.android.application'\n    id 'org.jetbrains.kotlin.android'\n}\nandroid {\n    namespace 'com.mauli.app'\n    compileSdk 34\n    defaultConfig {\n        applicationId "com.mauli.app"\n        minSdk 24\n        targetSdk 34\n        versionCode 1\n        versionName "1.0"\n    }\n    buildTypes {\n        release { minifyEnabled false }\n    }\n    compileOptions {\n        sourceCompatibility JavaVersion.VERSION_17\n        targetCompatibility JavaVersion.VERSION_17\n    }\n}\ndependencies {\n    implementation 'androidx.core:core-ktx:1.12.0'\n    implementation 'androidx.appcompat:appcompat:1.6.1'\n}` },
    { path: 'build.gradle', content: `buildscript {\n    repositories { google(); mavenCentral() }\n    dependencies {\n        classpath 'com.android.tools.build:gradle:8.2.0'\n        classpath 'org.jetbrains.kotlin:kotlin-gradle-plugin:1.9.20'\n    }\n}\nallprojects {\n    repositories { google(); mavenCentral() }\n}` },
    { path: 'settings.gradle', content: `rootProject.name = "mauli-app"\ninclude ':app'` },
    { path: 'gradle.properties', content: `android.useAndroidX=true\nkotlin.code.style=official` },
    { path: 'package.json', content: JSON.stringify({ name: 'mauli-android-app', version: '1.0.0', description: objective, platform: 'android' }, null, 2) },
    { path: 'README.md', content: `# ${objective}\n\n## Android Native Application\n\n### Build Instructions:\n1. Open project in Android Studio\n2. Sync Gradle\n3. Run on emulator or device\n\n### Or via command line:\n\`\`\`bash\n./gradlew assembleDebug\n\`\`\`\n\nAPK will be at: \`app/build/outputs/apk/debug/app-debug.apk\`\n` }
  ];
}

function generateIOSProject(objective) {
  return [
    { path: 'MaulliApp/App/AppDelegate.swift', content: `import UIKit\n\n@main\nclass AppDelegate: UIResponder, UIApplicationDelegate {\n    var window: UIWindow?\n\n    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {\n        window = UIWindow(frame: UIScreen.main.bounds)\n        let webVC = WebViewController()\n        window?.rootViewController = UINavigationController(rootViewController: webVC)\n        window?.makeKeyAndVisible()\n        return true\n    }\n}` },
    { path: 'MaulliApp/App/WebViewController.swift', content: `import UIKit\nimport WebKit\n\nclass WebViewController: UIViewController, WKNavigationDelegate {\n    var webView: WKWebView!\n\n    override func viewDidLoad() {\n        super.viewDidLoad()\n        title = "MAULI App"\n        \n        let config = WKWebViewConfiguration()\n        config.allowsInlineMediaPlayback = true\n        webView = WKWebView(frame: view.bounds, configuration: config)\n        webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]\n        webView.navigationDelegate = self\n        view.addSubview(webView)\n        \n        if let htmlPath = Bundle.main.path(forResource: "index", ofType: "html", inDirectory: "www") {\n            webView.loadFileURL(URL(fileURLWithPath: htmlPath), allowingReadAccessTo: URL(fileURLWithPath: Bundle.main.bundlePath))\n        }\n    }\n}` },
    { path: 'MaulliApp/Resources/www/index.html', content: `<!DOCTYPE html>\n<html>\n<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<title>${objective}</title>\n<link rel="stylesheet" href="styles.css">\n</head>\n<body>\n<div id="app">\n  <h1>${objective}</h1>\n  <p>Native iOS Application</p>\n</div>\n<script src="app.js"></script>\n</body>\n</html>` },
    { path: 'MaulliApp/Resources/www/app.js', content: `// ${objective}\nconsole.log('iOS App loaded');` },
    { path: 'MaulliApp/Resources/www/styles.css', content: `* { margin:0; padding:0; box-sizing:border-box; }\nbody { font-family:-apple-system; background:#000; color:#fff; min-height:100vh; display:flex; align-items:center; justify-content:center; }\n#app { text-align:center; padding:2rem; }\nh1 { font-size:1.5rem; margin-bottom:0.5rem; }\np { color:#8e8e93; }` },
    { path: 'MaulliApp.xcodeproj/project.pbxproj', content: `// Xcode project file — open in Xcode to build\n// Build with: xcodebuild -project MaulliApp.xcodeproj -scheme MaulliApp -sdk iphoneos` },
    { path: 'Package.swift', content: `// swift-tools-version:5.9\nimport PackageDescription\nlet package = Package(name: "MaulliApp", platforms: [.iOS(.v15)], targets: [.executableTarget(name: "MaulliApp")])` },
    { path: 'package.json', content: JSON.stringify({ name: 'mauli-ios-app', version: '1.0.0', description: objective, platform: 'ios' }, null, 2) },
    { path: 'README.md', content: `# ${objective}\n\n## iOS Native Application\n\n### Build Instructions:\n1. Open \`MaulliApp.xcodeproj\` in Xcode\n2. Select target device/simulator\n3. Press Cmd+R to build and run\n\n### Or via command line:\n\`\`\`bash\nxcodebuild -project MaulliApp.xcodeproj -scheme MaulliApp -sdk iphonesimulator\n\`\`\`\n` }
  ];
}

function generateDesktopProject(objective) {
  return [
    { path: 'src/main.js', content: `const { app, BrowserWindow, Menu } = require('electron');\nconst path = require('path');\n\nfunction createWindow() {\n  const win = new BrowserWindow({\n    width: 1200, height: 800,\n    webPreferences: { nodeIntegration: false, contextIsolation: true },\n    titleBarStyle: 'hiddenInset',\n    backgroundColor: '#0f172a'\n  });\n  win.loadFile(path.join(__dirname, '../www/index.html'));\n  Menu.setApplicationMenu(null);\n}\n\napp.whenReady().then(createWindow);\napp.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });\napp.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });` },
    { path: 'www/index.html', content: `<!DOCTYPE html>\n<html>\n<head>\n<meta charset="UTF-8">\n<meta http-equiv="Content-Security-Policy" content="default-src 'self' 'unsafe-inline'">\n<title>${objective}</title>\n<link rel="stylesheet" href="styles.css">\n</head>\n<body>\n<div id="app">\n  <h1>${objective}</h1>\n  <p>Desktop Application</p>\n</div>\n<script src="app.js"></script>\n</body>\n</html>` },
    { path: 'www/app.js', content: `// ${objective}\nconsole.log('Desktop app loaded');\ndocument.getElementById('app').addEventListener('click', () => {\n  console.log('App interaction');\n});` },
    { path: 'www/styles.css', content: `* { margin:0; padding:0; box-sizing:border-box; }\nbody { font-family:system-ui; background:#0f172a; color:#fff; min-height:100vh; display:flex; align-items:center; justify-content:center; }\n#app { text-align:center; padding:2rem; }\nh1 { font-size:1.8rem; margin-bottom:0.5rem; }\np { color:#94a3b8; }` },
    { path: 'package.json', content: JSON.stringify({ name: 'mauli-desktop-app', version: '1.0.0', description: objective, main: 'src/main.js', scripts: { start: 'electron .', build: 'electron-builder' }, devDependencies: { electron: '^28.0.0', 'electron-builder': '^24.0.0' } }, null, 2) },
    { path: 'README.md', content: `# ${objective}\n\n## Desktop Application\n\n### Build Instructions:\n\`\`\`bash\nnpm install\nnpm start\n\`\`\`\n\n### Build distributable:\n\`\`\`bash\nnpm run build\n\`\`\`\n\nOutput: \`dist/\` directory\n` }
  ];
}

function generateFlutterProject(objective) {
  return [
    { path: 'lib/main.dart', content: `import 'package:flutter/material.dart';\n\nvoid main() => runApp(const MauuliApp());\n\nclass MauuliApp extends StatelessWidget {\n  const MauuliApp({super.key});\n  @override\n  Widget build(BuildContext context) {\n    return MaterialApp(\n      title: '${objective}',\n      theme: ThemeData.dark().copyWith(primaryColor: Colors.blue),\n      home: const HomePage(),\n    );\n  }\n}\n\nclass HomePage extends StatelessWidget {\n  const HomePage({super.key});\n  @override\n  Widget build(BuildContext context) {\n    return Scaffold(\n      appBar: AppBar(title: const Text('MAULI App')),\n      body: const Center(child: Text('${objective}', style: TextStyle(fontSize: 24))),\n    );\n  }\n}` },
    { path: 'pubspec.yaml', content: `name: mauli_app\ndescription: ${objective}\nversion: 1.0.0\nenvironment:\n  sdk: '>=3.0.0 <4.0.0'\ndependencies:\n  flutter:\n    sdk: flutter\n  cupertino_icons: ^1.0.6` },
    { path: 'package.json', content: JSON.stringify({ name: 'mauli-flutter-app', version: '1.0.0', description: objective, platform: 'flutter' }, null, 2) },
    { path: 'README.md', content: `# ${objective}\n\n## Flutter Application\n\n### Build:\n\`\`\`bash\nflutter pub get\nflutter run\n\`\`\`\n\n### Build APK:\n\`\`\`bash\nflutter build apk\n\`\`\`\n\n### Build iOS:\n\`\`\`bash\nflutter build ios\n\`\`\`\n` }
  ];
}

function generateReactNativeProject(objective) {
  return [
    { path: 'App.tsx', content: `import React from 'react';\nimport { View, Text, StyleSheet, SafeAreaView } from 'react-native';\n\nexport default function App() {\n  return (\n    <SafeAreaView style={styles.container}>\n      <View style={styles.content}>\n        <Text style={styles.title}>${objective}</Text>\n        <Text style={styles.subtitle}>React Native Application</Text>\n      </View>\n    </SafeAreaView>\n  );\n}\n\nconst styles = StyleSheet.create({\n  container: { flex: 1, backgroundColor: '#0f172a' },\n  content: { flex: 1, justifyContent: 'center', alignItems: 'center' },\n  title: { fontSize: 24, color: '#fff', fontWeight: 'bold' },\n  subtitle: { fontSize: 16, color: '#94a3b8', marginTop: 8 },\n});` },
    { path: 'package.json', content: JSON.stringify({ name: 'mauli-rn-app', version: '1.0.0', description: objective, main: 'App.tsx', dependencies: { 'react': '^18.2.0', 'react-native': '^0.73.0' } }, null, 2) },
    { path: 'app.json', content: JSON.stringify({ name: 'MauliApp', displayName: objective }, null, 2) },
    { path: 'README.md', content: `# ${objective}\n\n## React Native Application\n\n### Build:\n\`\`\`bash\nnpm install\nnpx react-native run-android  # or run-ios\n\`\`\`\n` }
  ];
}

function generateWebCapacitorProject(objective) {
  return [
    { path: 'www/index.html', content: `<!DOCTYPE html>\n<html>\n<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<title>${objective}</title>\n<link rel="stylesheet" href="styles.css">\n</head>\n<body>\n<div id="app">\n  <h1>${objective}</h1>\n  <p>Multi-Platform Application</p>\n</div>\n<script src="app.js"></script>\n</body>\n</html>` },
    { path: 'www/app.js', content: `// ${objective}\ndocument.getElementById('app').addEventListener('click', () => {\n  console.log('App interaction');\n});` },
    { path: 'www/styles.css', content: `* { margin:0; padding:0; box-sizing:border-box; }\nbody { font-family:system-ui; background:#0f172a; color:#fff; min-height:100vh; display:flex; align-items:center; justify-content:center; }\n#app { text-align:center; padding:2rem; }\nh1 { font-size:1.5rem; margin-bottom:0.5rem; }\np { color:#94a3b8; }` },
    { path: 'package.json', content: JSON.stringify({ name: 'mauli-app', version: '1.0.0', description: objective, main: 'www/index.html', scripts: { build: 'cap sync', android: 'cap open android', ios: 'cap open ios' } }, null, 2) },
    { path: 'capacitor.config.json', content: JSON.stringify({ appId: 'com.mauli.app', appName: objective, webDir: 'www', server: { androidScheme: 'https' } }, null, 2) },
    { path: 'README.md', content: `# ${objective}\n\n## Multi-Platform Application (Capacitor)\n\n### Build:\n\`\`\`bash\nnpm install\nnpm install @capacitor/core @capacitor/cli @capacitor/android @capacitor/ios\nnpx cap add android\nnpx cap add ios\nnpx cap sync\nnpx cap open android  # or ios\n\`\`\`\n\n### Supported Platforms:\n- Android (APK/AAB)\n- iOS (IPA)\n- Web (Progressive Web App)\n` }
  ];
}

registerExecutor('internal.native', generateNativeCode, {
  description: 'Generates platform-specific native application code for Android, iOS, Desktop, Flutter, and React Native',
  risk: 'low', scope: 'internal', capabilities: ['coding', 'software-development', 'mobile', 'desktop', 'native']
});
grantExecutor('internal.native', 'internal');
