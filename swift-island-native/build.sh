#!/bin/bash

# Dynamic Island Swift Builder
# 构建原生 Swift 灵动岛应用

set -e

echo "🏗️ Building Dynamic Island Swift Application..."

# 检查是否在正确的目录
if [ ! -f "DynamicIslandMain.swift" ]; then
    echo "❌ Error: DynamicIslandMain.swift not found. Please run from swift-island-native directory."
    exit 1
fi

# 设置变量
BUILD_DIR="../build/swift-island"
APP_NAME="DynamicIsland"
TARGET_DIR="$BUILD_DIR"

# 创建构建目录
mkdir -p "$BUILD_DIR"

echo "📦 Compiling Swift sources..."

# 编译 Swift 文件为可执行文件
swiftc \
    -o "$TARGET_DIR/$APP_NAME" \
    -framework AppKit \
    -framework SwiftUI \
    -framework Foundation \
    -O \
    DynamicIslandMain.swift \
    AppDelegate.swift \
    ElectronBridge.swift \
    IslandWindowController.swift \
    IslandContentView.swift \
    WindowLevelManager.swift

# 检查编译结果
if [ -f "$TARGET_DIR/$APP_NAME" ]; then
    echo "✅ Build successful!"
    echo "📍 Executable location: $TARGET_DIR/$APP_NAME"
    
    # 设置执行权限
    chmod +x "$TARGET_DIR/$APP_NAME"
    
    # 显示文件信息
    echo "📊 File info:"
    ls -la "$TARGET_DIR/$APP_NAME"
    
    echo ""
    echo "🚀 Usage:"
    echo "  $TARGET_DIR/$APP_NAME               # Run standalone"
    echo "  $TARGET_DIR/$APP_NAME --help        # Show help"
    echo "  echo '{\"action\":\"show\"}' | $TARGET_DIR/$APP_NAME  # JSON API"
    
else
    echo "❌ Build failed!"
    exit 1
fi
