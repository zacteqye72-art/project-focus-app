#!/bin/bash

# Project Focus 安装脚本
echo "🚀 开始安装 Project Focus..."

# 检查Node.js
if ! command -v node &> /dev/null; then
    echo "❌ 未找到Node.js，请先安装Node.js v18+"
    echo "📥 下载地址：https://nodejs.org/"
    exit 1
fi

# 检查Node.js版本
NODE_VERSION=$(node -v | cut -d 'v' -f 2 | cut -d '.' -f 1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "⚠️ Node.js版本过低（当前：$(node -v)），推荐v18+"
fi

echo "✅ Node.js版本：$(node -v)"

# 安装依赖
echo "📦 安装依赖包..."
npm install --production

if [ $? -eq 0 ]; then
    echo "✅ 依赖安装完成"
else
    echo "❌ 依赖安装失败，尝试使用国内镜像..."
    npm config set registry https://registry.npmmirror.com
    npm install --production
fi

# 检查配置文件
if [ ! -f "config.js" ]; then
    echo "⚙️ 创建配置文件..."
    cp config.example.js config.js
    echo "📝 请编辑 config.js 文件，填入您的API密钥"
fi

echo ""
echo "🎉 Project Focus 安装完成！"
echo ""
echo "📋 下一步操作："
echo "1. 编辑 config.js 文件，填入您的API密钥"
echo "2. 运行：npm start"
echo ""
echo "🔑 获取API密钥："
echo "• 阿里云百炼：https://bailian.console.aliyun.com"
echo "• DashScope：https://dashscope.aliyun.com"
echo ""

