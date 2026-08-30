#!/bin/bash
echo "=== Building Android APK for Implement backend code and API User interface ==="
echo "Step 1: Install dependencies..."
npm install
echo "Step 2: Install Capacitor..."
npm install @capacitor/core @capacitor/cli @capacitor/android
echo "Step 3: Initialize Capacitor..."
npx cap init implement-backend-code-and-api-user-interface com.mauli.implement-backend-code-and-api-user-interface --web-dir www
echo "Step 4: Add Android platform..."
npx cap add android
echo "Step 5: Sync web assets..."
npx cap sync
echo "Step 6: Open Android Studio..."
npx cap open android
echo ""
echo "In Android Studio: Build > Build APK(s)"
echo "APK: android/app/build/outputs/apk/debug/app-debug.apk"
echo "Done!"