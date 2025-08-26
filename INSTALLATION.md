# Project Focus - 安装说明

## 📦 安装方式

### 方式一：使用已打包的文件（推荐）

1. 解压 `project-focus-app-0.1.0.tgz` 文件
2. 在解压后的目录中运行：
   ```bash
   npm install
   npm start
   ```

### 方式二：从源码安装

1. 确保你的Mac上安装了Node.js (推荐v18+)
2. 解压项目文件到任意目录
3. 在终端中进入项目目录
4. 运行以下命令：
   ```bash
   npm install
   npm start
   ```

## ⚙️ 配置

1. **AI API配置**：
   - 复制 `config.example.js` 为 `config.js`
   - 在 `config.js` 中填入你的API密钥：
   ```javascript
   module.exports = {
     ai: {
       provider: 'bailian', // 或 'dashscope'
       apiKey: '你的API密钥'
     }
   };
   ```

2. **获取API密钥**：
   - 阿里云百炼：https://bailian.console.aliyun.com
   - DashScope：https://dashscope.aliyun.com

## 🚀 运行

配置完成后，运行：
```bash
npm start
```

应用将启动，你会看到Project Focus的主界面。

## 🎯 功能

- AI助手对话
- 专注会话计时
- 智能屏幕分析
- 分心检测提醒
- 专注统计报告

## 🔧 故障排除

### 常见问题：

1. **"找不到模块"错误**：
   ```bash
   rm -rf node_modules
   npm install
   ```

2. **权限问题**：
   ```bash
   sudo npm install
   ```

3. **网络问题**：
   ```bash
   npm config set registry https://registry.npmmirror.com
   npm install
   ```

4. **API配置问题**：
   - 确保config.js文件格式正确
   - 检查API密钥是否有效
   - 确保网络可以访问API端点

## 📞 支持

如果遇到问题，请检查：
- Node.js版本是否为v18+
- 网络连接是否正常
- API密钥是否配置正确

---

Project Focus v0.1.0 - 专注力管理应用

