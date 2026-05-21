# Auto Deploy

前端自动化部署工具 — GUI 桌面应用 + CLI 命令行。Git 拉取 → 构建 → 部署到服务器，支持自动备份和版本回滚。

## 安装

```bash
npm install
npm run dev             # 开发模式（Vite + Electron 热加载）
npm run electron:pack   # 生产打包（输出到 release/win-unpacked/）
```

## 快速开始

1. 打包后运行 `release/win-unpacked/Auto Deploy.exe`
2. 首次启动自动在 EXE 旁边创建 `deploy.config.json`
3. 在「设置」页面填写仓库地址、服务器信息
4. 点击「测试 Git 连接」和「测试 SSH 连接」确认连通
5. 切换到「部署」页面，选择分支或 Tag，点击「模拟部署」验证
6. 确认无误后点击「开始部署」

## 配置文件

`deploy.config.json` 放在 EXE 同目录，支持多仓库：

```json
{
  "repos": [
    {
      "name": "前端项目",
      "git": {
        "url": "https://gitee.com/user/repo.git",
        "branch": "main",
        "cloneDir": "./.deploy-cache",
        "username": "Gitee 用户名",
        "token": "私人令牌"
      },
      "build": {
        "command": "npm install && npm run build",
        "outputDir": "dist"
      },
      "server": {
        "host": "192.168.1.100",
        "port": 22,
        "username": "root",
        "password": "",
        "privateKey": "~/.ssh/id_rsa"
      },
      "deploy": {
        "remotePath": "/var/www/myapp",
        "backupKeep": 5,
        "preDeployCommands": [],
        "postDeployCommands": ["nginx -s reload"],
        "preDeployFiles": [
          {
            "path": "config.js",
            "content": "window.API_URL = 'https://api.example.com'"
          }
        ]
      }
    }
  ]
}
```

### Git 认证

| 地址格式 | 配置方式 |
|---------|---------|
| `https://gitee.com/user/repo.git` | 填写用户名和私人令牌（Gitee: 设置 → 私人令牌） |
| `git@gitee.com:user/repo.git` | 配置 SSH 公钥，留空用户名和 Token |

子模块使用 SSH 地址时，工具自动将 `.gitmodules` 中 URL 改写为 HTTPS。

### 服务器认证

填**密码**或**私钥路径**二选一。都填则私钥优先。

## 部署流程

```
拉取代码 → 构建项目 → 覆盖产物文件 → 压缩 → 备份旧文件 → 上传 → 解压 → 执行脚本 → 清理旧备份
```

### 服务器目录结构

```
/var/www/myapp/
├── .backup/                          ← 历史备份（隐藏目录，部署不会被删除）
│   ├── v20260521_143000_abc.tar.gz
│   └── v20260520_120000_def.tar.gz
├── index.html
└── assets/
```

部署前自动将当前文件备份为 `.tar.gz`，然后解压新文件直接覆盖。回滚时清空并从备份 tarball 恢复。`.backup` 是隐藏目录，`rm -rf *` 不会删除它。

## 版本回滚

在「版本管理」页面选择仓库，看到所有历史备份列表（最新标记为"最新"），点击「回滚到此版本」即可。

## 模拟部署

部署页面「模拟部署」按钮：在本地 `.deploy-simulate/<仓库名>/` 目录执行完整流程（跳过 SSH 连接和上传），用于验证：

- 构建产物是否正确
- 部署前文件覆盖是否生效
- 最终的文件结构是否符合预期

## 分支 / Tag 选择

部署页面自动拉取远程分支和 Tag 列表，支持输入过滤和刷新。Tag 按语义版本倒序排列（`v2.0.0 > v1.10.0 > v1.2.0`）。

## 部署前文件覆盖

在设置页面每个仓库底部可以配置「部署前文件覆盖」：指定产物目录中要替换的文件路径和自定义内容，构建完成后自动写入产物目录再压缩部署。适用于部署时替换 API 地址、环境配置等。

## CLI 模式

```bash
# 部署（默认仓库索引 0）
node src/cli.js deploy --config ./deploy.config.json

# 指定仓库和分支
node src/cli.js deploy --repo 1 --branch release/v2.0

# 指定 Tag
node src/cli.js deploy --tag v1.5.0

# 查看备份版本列表
node src/cli.js list --repo 0

# 回滚到指定备份
node src/cli.js rollback --version v20260521_143000_abc12345
```

## 技术栈

| 层 | 技术 |
|---|------|
| GUI 框架 | Electron 28 |
| 前端 | Vue 3 + TypeScript + Vite 5 |
| CLI | Node.js + Commander |
| Git 操作 | simple-git + spawn |
| SSH | ssh2 |
| 压缩 | 系统 tar 命令 |

## 环境要求

- Node.js 18
- Windows 10+（自带 tar）或已安装 Git for Windows
