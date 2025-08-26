# DMG 文件损坏问题解决方案

## 问题描述
DMG 文件在其他电脑上显示"损坏"或无法打开。

## 主要原因

### 1. 架构兼容性问题
- **问题**: 只打包了 ARM64 架构，Intel Mac 无法运行
- **解决**: 使用 `--universal` 参数打包支持两种架构

### 2. macOS 版本兼容性
- **问题**: Electron 30.0.0 需要 macOS 10.15+ 
- **解决**: 在 `package.json` 中指定 `electronVersion`

### 3. 代码签名问题
- **问题**: 未签名或签名无效
- **解决**: 配置代码签名和权限文件

## 解决方案

### 方法 1: 构建通用版本（推荐）
```bash
npm run build:universal
```

### 方法 2: 分别构建
```bash
# 只构建 ARM64 版本
npm run build:arm64

# 只构建 Intel 版本  
npm run build:x64
```

### 方法 3: 手动指定架构
```bash
npx electron-builder --config build/electron-builder.yml --universal
```

## 验证构建结果

构建完成后，检查 `dist` 目录：
- `Project Focus-0.1.0-arm64.dmg` - ARM64 版本
- `Project Focus-0.1.0-x64.dmg` - Intel 版本  
- `Project Focus-0.1.0.dmg` - 通用版本

## 测试建议

1. **本地测试**: 在构建机器上测试 DMG
2. **虚拟机测试**: 使用不同 macOS 版本的虚拟机测试
3. **多架构测试**: 确保在 Intel 和 Apple Silicon Mac 上都能运行

## 常见错误

### "无法打开，因为它来自身份不明的开发者"
- 右键点击 → "打开"
- 或在系统偏好设置 → 安全性与隐私中允许

### "应用程序已损坏"
- 检查架构兼容性
- 重新构建通用版本
- 验证文件完整性

## 高级配置

如需代码签名，请：
1. 获取 Apple Developer 证书
2. 配置 `afterSign` 脚本
3. 启用 `hardenedRuntime` 和 `entitlements`
