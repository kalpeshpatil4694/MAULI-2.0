#!/bin/bash
echo "=== Building Desktop App for Implement backend code and API User interface ==="
npm install
npm install electron electron-builder --save-dev
npx electron-builder --linux --win --mac
echo "Output in: dist/"