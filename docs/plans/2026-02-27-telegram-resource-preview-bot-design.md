# Telegram 资源预览机器人 - 系统设计文档

> 创建日期：2026-02-27
> 状态：已确认，待实施

## 1. 项目概述

### 1.1 项目简介

一个 Telegram 资源预览机器人系统，包含管理员后台和 Bot 服务。管理员可以配置多个 Bot、上传资源、为不同邀请链接配置展示内容和广告。用户通过邀请链接启动 Bot 后，按顺序浏览资源，每条资源之间插入广告，广告倒计时结束后自动展示下一条资源。

### 1.2 技术栈

| 层级 | 技术选型 |
|------|----------|
| 后端框架 | Node.js + Express + TypeScript |
| 前端框架 | React + Ant Design + Vite |
| 数据库 | PostgreSQL + Prisma ORM |
| Telegram Bot | grammY |
| 包管理器 | pnpm (workspaces monorepo) |
| 部署 | PM2 + Nginx |
| 认证 | 用户名密码 + JWT |
| 媒体存储 | 本地文件系统 |

### 1.3 架构决策

- **进程架构**：双进程分离 — API 服务和 Bot Runner 作为独立进程运行，通过共享数据库通信
- **多Bot管理**：单进程多Bot — 一个 Bot Runner 进程内管理所有 Bot 实例
- **规模定位**：小规模（1-5个Bot，<1万用户）

## 2. 项目结构

```
sourceBotV2/
├── package.json              # 根 package，pnpm workspaces 配置
├── pnpm-workspace.yaml       # pnpm workspace 声明
├── tsconfig.base.json        # 共享 TypeScript 配置
├── ecosystem.config.js       # PM2 配置（API + Bot Runner 两个进程）
│
├── packages/
│   ├── shared/               # 共享类型定义和工具函数
│   │   ├── src/
│   │   │   ├── types/        # 前后端共享的 TypeScript 类型
│   │   │   └── constants/    # 共享常量
│   │   └── package.json
│   │
│   ├── server/               # Express API 服务
│   │   ├── src/
│   │   │   ├── app.ts        # Express 应用入口
│   │   │   ├── routes/       # API 路由
│   │   │   ├── controllers/  # 控制器
│   │   │   ├── services/     # 业务逻辑层
│   │   │   ├── middleware/   # 中间件（auth、upload 等）
│   │   │   └── utils/        # 工具函数
│   │   ├── prisma/
│   │   │   └── schema.prisma # 数据库 Schema
│   │   └── package.json
│   │
│   ├── bot/                  # Bot Runner 服务
│   │   ├── src/
│   │   │   ├── index.ts      # Bot Runner 入口
│   │   │   ├── manager/      # 多 Bot 管理器
│   │   │   ├── handlers/     # 消息处理器
│   │   │   └── services/     # Bot 业务逻辑
│   │   └── package.json
│   │
│   └── client/               # React 前端
│       ├── src/
│       │   ├── pages/        # 页面组件
│       │   ├── components/   # 通用组件
│       │   ├── services/     # API 调用层
│       │   ├── stores/       # 状态管理
│       │   └── utils/        # 工具函数
│       ├── vite.config.ts
│       └── package.json
│
├── uploads/                  # 媒体文件存储目录
├── nginx.conf                # Nginx 配置示例
└── docs/plans/               # 设计文档
```

**关键设计点：**
- `shared` 包让前后端共享类型定义，避免重复定义
- `server` 和 `bot` 共享同一个 Prisma Client（从 server 包引用）
- `uploads/` 在项目根目录，API 负责写入，Bot 负责读取

## 3. 数据库设计（Prisma Schema）

### 3.1 管理员 & 机器人

```prisma
model Admin {
  id        Int      @id @default(autoincrement())
  username  String   @unique
  password  String   // bcrypt 哈希
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model Bot {
  id        Int      @id @default(autoincrement())
  token     String   @unique
  name      String
  username  String?  // Bot 的 @username，启动后自动获取
  isActive  Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  inviteLinks InviteLink[]
  fileIds     BotFileId[]
  botUsers    BotUser[]
}

model InviteLink {
  id        Int      @id @default(autoincrement())
  botId     Int
  code      String   // Deep Link 的 start 参数值
  name      String   // 备注名称
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  bot              Bot               @relation(fields: [botId], references: [id], onDelete: Cascade)
  contentBindings  ContentBinding[]
  adBindings       AdBinding[]
  botUsers         BotUser[]

  @@unique([botId, code])
}
```

### 3.2 资源管理

```prisma
model ResourceGroup {
  id        Int        @id @default(autoincrement())
  name      String
  sortOrder Int        @default(0)
  createdAt DateTime   @default(now())
  updatedAt DateTime   @updatedAt

  resources Resource[]
}

model Resource {
  id        Int      @id @default(autoincrement())
  groupId   Int?
  type      String   // 'photo' | 'video' | 'media_group'
  caption   String?  // 文字介绍
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  group           ResourceGroup?   @relation(fields: [groupId], references: [id], onDelete: SetNull)
  mediaFiles      MediaFile[]
  contentBindings ContentBinding[]
  adBindings      AdBinding[]
}

model MediaFile {
  id         Int      @id @default(autoincrement())
  resourceId Int
  type       String   // 'photo' | 'video'
  filePath   String   // 服务器本地路径
  fileName   String   // 原始文件名
  mimeType   String
  fileSize   Int
  sortOrder  Int      @default(0)
  createdAt  DateTime @default(now())

  resource   Resource   @relation(fields: [resourceId], references: [id], onDelete: Cascade)
  botFileIds BotFileId[]
}
```

### 3.3 file_id 缓存 & 内容/广告配置

```prisma
model BotFileId {
  id          Int    @id @default(autoincrement())
  botId       Int
  mediaFileId Int
  fileId      String // Telegram 返回的 file_id

  bot       Bot       @relation(fields: [botId], references: [id], onDelete: Cascade)
  mediaFile MediaFile @relation(fields: [mediaFileId], references: [id], onDelete: Cascade)

  @@unique([botId, mediaFileId])
}

model ContentBinding {
  id           Int @id @default(autoincrement())
  inviteLinkId Int
  resourceId   Int
  sortOrder    Int @default(0)

  inviteLink InviteLink @relation(fields: [inviteLinkId], references: [id], onDelete: Cascade)
  resource   Resource   @relation(fields: [resourceId], references: [id], onDelete: Restrict)
}

model AdBinding {
  id           Int    @id @default(autoincrement())
  inviteLinkId Int
  resourceId   Int
  sortOrder    Int    @default(0)
  buttons      Json?  // 内联键盘按钮配置 [{text, url}]

  inviteLink InviteLink @relation(fields: [inviteLinkId], references: [id], onDelete: Cascade)
  resource   Resource   @relation(fields: [resourceId], references: [id], onDelete: Restrict)
}
```

> **注意**：`ContentBinding` 和 `AdBinding` 对 `Resource` 使用 `onDelete: Restrict`，实现"正在使用的资源禁止删除"。

### 3.4 用户 & 统计

```prisma
model BotUser {
  id            Int      @id @default(autoincrement())
  telegramId    BigInt
  botId         Int
  inviteLinkId  Int
  firstName     String?
  lastName      String?
  username      String?
  firstSeenAt   DateTime @default(now())
  lastSeenAt    DateTime @default(now())

  bot        Bot        @relation(fields: [botId], references: [id], onDelete: Cascade)
  inviteLink InviteLink @relation(fields: [inviteLinkId], references: [id], onDelete: Cascade)
  sessions   UserSession[]

  @@unique([telegramId, botId])
}

model UserSession {
  id              Int      @id @default(autoincrement())
  botUserId       Int
  currentIndex    Int      @default(0)
  isCompleted     Boolean  @default(false)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  botUser BotUser @relation(fields: [botUserId], references: [id], onDelete: Cascade)
}

model AdImpression {
  id           Int      @id @default(autoincrement())
  botId        Int
  inviteLinkId Int
  adBindingId  Int
  telegramId   BigInt
  viewedAt     DateTime @default(now())
}

model SystemSetting {
  id    Int    @id @default(autoincrement())
  key   String @unique
  value Json
}
```

**Schema 设计要点：**
- `BotUser` 用 `@@unique([telegramId, botId])` 确保同一用户在同一 Bot 下只有一条记录
- `UserSession` 记录用户浏览进度，支持断点续看
- `AdImpression` 独立记录广告展示，方便统计查询
- `SystemSetting` 用 key-value 存储系统配置（预览结束内容、广告展示时间、统计群组 ID 等）

## 4. API 接口设计

### 4.1 认证 & 机器人管理

```
POST   /api/auth/login              # 登录，返回 JWT
GET    /api/auth/me                  # 获取当前管理员信息

GET    /api/bots                     # 机器人列表
POST   /api/bots                     # 添加机器人（token + 备注）
PUT    /api/bots/:id                 # 编辑机器人
DELETE /api/bots/:id                 # 删除机器人
POST   /api/bots/:id/verify         # 验证 Bot Token 有效性

GET    /api/bots/:botId/links        # 某 Bot 的邀请链接列表
POST   /api/bots/:botId/links        # 创建邀请链接
PUT    /api/bots/:botId/links/:id    # 编辑邀请链接
DELETE /api/bots/:botId/links/:id    # 删除邀请链接
```

### 4.2 资源管理

```
GET    /api/resource-groups              # 分组列表
POST   /api/resource-groups              # 创建分组
PUT    /api/resource-groups/:id          # 编辑分组
DELETE /api/resource-groups/:id          # 删除分组
PUT    /api/resource-groups/sort         # 调整分组排序

GET    /api/resources                    # 资源列表（支持分组筛选、搜索、分页）
POST   /api/resources                    # 上传资源（multipart/form-data）
PUT    /api/resources/:id                # 编辑资源（修改文字、调整分组）
DELETE /api/resources/:id                # 删除资源（被引用时返回 403）
PUT    /api/resources/:id/group          # 移动资源到其他分组
```

上传资源请求体（`multipart/form-data`）：
- `files[]` — 一个或多个媒体文件
- `caption` — 文字介绍
- `groupId` — 所属分组 ID（可选）
- `type` — `'photo'` | `'video'` | `'media_group'`

### 4.3 内容配置 & 广告配置

```
GET    /api/links/:linkId/contents       # 获取某链接的内容配置列表
PUT    /api/links/:linkId/contents       # 批量设置内容（资源 ID 数组 + 顺序）
PUT    /api/links/:linkId/contents/sort  # 调整内容顺序

GET    /api/links/:linkId/ads            # 获取某链接的广告配置列表
PUT    /api/links/:linkId/ads            # 批量设置广告（资源 ID 数组 + 顺序 + 按钮配置）
PUT    /api/links/:linkId/ads/:id        # 编辑单条广告（修改按钮配置）
PUT    /api/links/:linkId/ads/sort       # 调整广告顺序
```

内容配置批量设置请求体：
```json
{
  "items": [
    { "resourceId": 1, "sortOrder": 0 },
    { "resourceId": 5, "sortOrder": 1 },
    { "resourceId": 3, "sortOrder": 2 }
  ]
}
```

广告配置批量设置请求体：
```json
{
  "items": [
    {
      "resourceId": 2,
      "sortOrder": 0,
      "buttons": [
        { "text": "点击查看", "url": "https://example.com" }
      ]
    }
  ]
}
```

### 4.4 用户 & 统计

```
GET    /api/users                        # 用户列表（支持搜索、按来源筛选、分页）
       ?search=xxx                       # 搜索用户名/ID
       &botId=1                          # 按机器人筛选
       &linkId=2                         # 按邀请链接筛选
       &page=1&pageSize=20              # 分页

GET    /api/stats/overview               # 总体统计（今日新增、总用户、今日广告展示）
GET    /api/stats/daily                  # 每日统计数据（折线图用）
       ?startDate=2026-01-01&endDate=2026-02-27
GET    /api/stats/by-link                # 按链接细分统计
       ?botId=1&startDate=...&endDate=...
```

### 4.5 系统设置

```
GET    /api/settings                     # 获取所有系统设置
PUT    /api/settings                     # 批量更新系统设置
```

请求体示例：
```json
{
  "endContent": {
    "text": "预览已结束，感谢观看！",
    "buttons": [{ "text": "了解更多", "url": "https://example.com" }]
  },
  "adDisplaySeconds": 5,
  "statsGroupId": "-1001234567890"
}
```

## 5. Bot 逻辑设计

### 5.1 Bot Manager（多 Bot 管理器）

```
BotManager 职责：
├── 启动时从数据库加载所有 isActive=true 的 Bot
├── 为每个 Bot 创建 grammY Bot 实例
├── 注册统一的消息处理器
├── 启动 polling（长轮询）
├── 提供动态管理接口：
│   ├── startBot(botId)    # 启动新 Bot
│   ├── stopBot(botId)     # 停止 Bot
│   └── restartBot(botId)  # 重启 Bot（Token 变更时）
└── 定期轮询数据库检查配置变更（或 API 进程写标记文件触发）
```

Bot Runner 进程启动流程：
1. 连接数据库（复用 Prisma Client）
2. 加载所有活跃 Bot 配置
3. 逐个创建 grammY Bot 实例并启动 polling
4. 监听配置变更（轮询数据库或文件信号）

### 5.2 用户交互流程

```
用户点击 t.me/botname?start=abc123
        │
        ▼
Bot 收到 /start abc123
        │
        ▼
查询 InviteLink: botId + code="abc123"
        │
        ├── 未找到 → 不回复，忽略
        │
        ▼ 找到
记录/更新 BotUser（telegramId + botId）
创建 UserSession（currentIndex=0）
        │
        ▼
加载该链接的 ContentBinding 列表（按 sortOrder）
加载该链接的 AdBinding 列表（按 sortOrder）
        │
        ▼
发送资源1 + 翻页按钮「下一页 ▶」
        │
        ▼
用户点击「下一页 ▶」
        │
        ▼
发送广告1（带内联按钮 + 倒计时提示）
记录 AdImpression
        │
        ▼
服务端 setTimeout 等待广告展示时间
        │
        ▼
自动发送资源2 + 翻页按钮
        │
        ▼
... 循环：资源N → 广告M → 资源N+1 ...
（广告按配置顺序轮询，用完从头循环）
        │
        ▼
所有资源发完 → 发送「预览结束」内容
```

### 5.3 file_id 缓存机制

```
发送资源时的流程：

需要发送 MediaFile 给用户
        │
        ▼
查询 BotFileId 表：botId + mediaFileId
        │
        ├── 存在 → 直接用 file_id 发送（零上传，极快）
        │
        └── 不存在 → 从本地文件路径读取文件上传发送
                      │
                      ▼
              从 Telegram 返回的 message 中提取 file_id
              写入 BotFileId 表缓存
```

对于媒体组（media_group），每个文件都会返回各自的 file_id，需要逐一缓存。

### 5.4 统计群组功能

```
统计群组中的交互流程：

统计人员转发某用户的消息到群中
        │
        ▼
Bot 检测到 forwarded message
提取 forward_from 的 telegramId
        │
        ▼
查询 BotUser 表（telegramId + 当前 botId）
        │
        ├── 找到 → 回复：
        │     用户ID: xxx
        │     姓名: xxx
        │     来源链接: xxx
        │     首次使用: xxx
        │     最后使用: xxx
        │
        └── 未找到 → 回复：无该用户记录
```

> 每个 Bot 只查询通过自己邀请链接进入的用户。若用户隐私设置禁止转发来源，`forward_from` 为空，回复"该用户已隐藏转发来源"。

### 5.5 进程间通信（API ↔ Bot Runner）

API 进程修改 Bot 配置后，Bot Runner 需要感知变更：

- Bot Runner 每 30 秒轮询一次数据库，检查 Bot 列表变更
- 当 API 进程增删改 Bot 时，写入信号文件（如 `.bot-reload`）
- Bot Runner 监听信号文件，立即重新加载
- 内容/广告配置变更无需重启 Bot，每次用户交互时实时查库

## 6. 前端页面设计

### 6.1 页面结构

```
├── /login                    # 登录页
│
├── /bots                     # 机器人管理
│   ├── 机器人列表（表格：名称、Token 脱敏、状态、操作）
│   └── /bots/:id/links       # 邀请链接管理
│       └── 链接列表（表格：链接名称、code、完整链接、操作）
│
├── /resources                # 资源管理
│   ├── 左侧：分组列表（可拖拽排序、增删改）
│   └── 右侧：资源列表（卡片/列表视图、搜索、分页）
│
├── /content                  # 内容配置
│   ├── 顶部：选择机器人 → 选择邀请链接
│   ├── 左侧：已配置的资源列表（可拖拽排序、可删除）
│   └── 右侧/弹窗：从资源库选择（分组筛选、搜索、多选）
│
├── /ads                      # 广告配置
│   ├── 顶部：选择机器人 → 选择邀请链接
│   ├── 左侧：已配置的广告列表（可拖拽排序）
│   │   └── 每条广告展开：配置内联按钮（text + url）
│   └── 右侧/弹窗：从资源库选择（分组筛选、搜索、多选）
│
├── /users                    # 用户列表
│   └── 表格 + 搜索框 + 筛选器（机器人、邀请链接）
│
├── /stats                    # 统计报表
│   ├── 顶部：总体概览卡片
│   ├── 中部：趋势折线图
│   └── 底部：按链接细分表格
│
└── /settings                 # 系统设置
    ├── 预览结束内容配置
    ├── 广告展示时间
    └── 统计群组 ID 配置
```

### 6.2 前端技术要点

- 状态管理：Zustand（轻量，TypeScript 友好）
- HTTP 请求：Axios + 拦截器处理 JWT 和错误
- 拖拽排序：`@dnd-kit/core`
- 图表：Ant Design Charts 或 ECharts
- 路由：React Router v6
- 构建工具：Vite

## 7. 错误处理与边界情况

### 7.1 资源删除保护

- 删除资源前查询 ContentBinding 和 AdBinding
- 若存在引用 → 返回 403 + 提示哪些链接正在使用
- Prisma 层面用 `onDelete: Restrict` 兜底

### 7.2 用户交互边界

- 无邀请链接启动（直接 /start 无参数）→ 不回复
- 无效邀请链接（code 不存在）→ 不回复
- 链接未配置内容 → 不回复或发送提示
- 链接未配置广告 → 跳过广告，直接发下一条资源
- 用户重复点击翻页按钮 → 通过 `answerCallbackQuery` 消除 loading，忽略重复请求
- 用户中途重新 /start → 重置会话，从头开始
- 用户隐私设置导致转发无来源 → 统计群组回复"该用户已隐藏转发来源"

### 7.3 Bot 运行边界

- Bot Token 无效 → 标记为异常，不影响其他 Bot
- Bot 被 Telegram 封禁 → 捕获异常，标记状态
- 发送文件失败（文件损坏/过大）→ 记录错误日志，跳过该资源
- file_id 失效（极少见）→ 捕获异常，删除缓存，重新上传

## 8. 部署架构

### 8.1 Nginx 反代

```
Nginx（80/443）
├── /api/*      → 反代到 Express API（端口 3000）
├── /*          → 静态文件服务（React 构建产物）
```

> `uploads/` 目录不直接对外暴露，通过 API 鉴权访问。

### 8.2 PM2 进程管理

```
PM2 进程：
├── api-server   → packages/server 编译后启动
│   └── max_memory_restart: 512M, instances: 1
└── bot-runner   → packages/bot 编译后启动
    └── max_memory_restart: 512M, instances: 1
```

### 8.3 安全考虑

- JWT Token 过期时间：24小时，前端拦截 401 自动跳转登录
- 密码存储：bcrypt 哈希，saltRounds=10
- Bot Token 存储：数据库明文（需要原文调用 API），前端展示时脱敏
- 文件上传限制：图片 10MB，视频 50MB（可在系统设置中调整）
- API 限流：express-rate-limit，防止暴力登录
- uploads 目录不直接对外暴露，通过 API 鉴权访问

## 9. 核心依赖清单

### 9.1 后端（server）

| 依赖 | 用途 |
|------|------|
| express | Web 框架 |
| @prisma/client + prisma | ORM |
| jsonwebtoken | JWT 签发与验证 |
| bcryptjs | 密码哈希 |
| multer | 文件上传处理 |
| express-rate-limit | API 限流 |
| cors | 跨域支持 |
| dotenv | 环境变量 |

### 9.2 Bot Runner（bot）

| 依赖 | 用途 |
|------|------|
| grammy | Telegram Bot 框架 |
| @prisma/client | 数据库访问（从 server 包引用） |

### 9.3 前端（client）

| 依赖 | 用途 |
|------|------|
| react + react-dom | UI 框架 |
| antd | UI 组件库 |
| react-router-dom | 路由 |
| axios | HTTP 请求 |
| zustand | 状态管理 |
| @dnd-kit/core + @dnd-kit/sortable | 拖拽排序 |
| @ant-design/charts 或 echarts | 图表 |
| dayjs | 日期处理 |

### 9.4 开发依赖（共享）

| 依赖 | 用途 |
|------|------|
| typescript | TypeScript 编译 |
| tsx | TypeScript 直接运行（开发环境） |
| @types/express | Express 类型定义 |
| @types/multer | Multer 类型定义 |
| @types/jsonwebtoken | JWT 类型定义 |
| @types/bcryptjs | bcryptjs 类型定义 |

---

> 文档状态：所有章节已通过确认，待转入实施规划阶段。
