#!/bin/bash
echo "=== Building Desktop App for Perform security review Secure data storage and encryption ==="
npm install
npm install electron electron-builder --save-dev
npx electron-builder --linux --win --mac
echo "Output in: dist/"