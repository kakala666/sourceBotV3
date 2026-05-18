# 常驻键盘:随便看看 / 我的收藏

## 背景

目前用户只能通过邀请链接 `?start=code` 进入,内容浏览路径单一(线性翻页 + 强制订阅)。需要给用户两个新的探索入口,作为 reply keyboard 常驻在客户端底部:

- **🎲 随便看看**:从所有曾上线过的资源里随机抽 1 条,带展开 / 收藏(无翻页)
- **⭐ 我的收藏**:按收藏时间倒序浏览,体验同邀请链接(翻页 + 展开 + 收藏)

## 目标

1. 给 bot 加 reply keyboard,常驻显示 2 个按钮
2. 「随便看看」单条投递,带展开 / 收藏,**不带翻页 / 搜索更多**
3. 「我的收藏」多条浏览,带翻页 / 展开 / 收藏 / 搜索更多,翻完发独立结束提示
4. 两个入口都受强制订阅 gate 约束(用 BotUser.inviteLinkId 的 gate 配置)
5. 欢迎语 + reply keyboard 在 `/start` 时一并发出

## 非目标

- 不做收藏列表的"取消收藏"(后续可加)
- 不做"随便看看"的资源排重(同一用户不会被排除已看过的)
- 不做收藏序列快照(用户在浏览中新收藏的资源会出现在序列前面,可能造成边界重复;若反馈再加)
- 不做后台搜索/查看每个用户的收藏

## Schema 变更

```prisma
model UserSession {
  id           Int      @id @default(autoincrement())
  botUserId    Int
  currentIndex Int      @default(0)
  isCompleted  Boolean  @default(false)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  // 新增:
  mode    String  @default("link")  // 'link' | 'favorite' | 'single'
  payload Json?                     // single 模式存 { resourceId: number }
}
```

加字段 + 默认值,兼容旧 session(默认 `link`)。`prisma db push` 即可,无数据迁移。

## SystemSetting 新增

key `welcomeText`,默认值:
```
欢迎使用 👋
使用下方按钮开启探索
```

后台「系统设置」页加一个 TextArea 编辑。

## 架构

### 新组件

| 文件 | 职责 |
|---|---|
| `bot/services/random-resource.ts` | 从 `ContentBinding` 引用过的 Resource 中随机取 1 条 |
| `bot/services/favorite-list.ts` | 加载某 botUser 的 favorites(按 createdAt desc) |
| `bot/handlers/home-keyboard.ts` | 「随便看看」/「我的收藏」消息 handler |

### 改动组件

| 文件 | 改动 |
|---|---|
| `server/prisma/schema.prisma` | UserSession 加 `mode` + `payload` 字段 |
| `bot/services/sender.ts` | 加 `buildHomeReplyKeyboard()` 工具函数 |
| `bot/services/session.ts` | `resetSession` 接受 `mode` + `payload` 参数;加 `getCurrentResourceFromSession()` |
| `bot/services/content.ts` | 加 `getWelcomeText()` |
| `bot/services/subscription-prompt.ts` | `buildPromptKeyboard` callbackPrefix 已支持自定义,无需改 |
| `bot/handlers/callback.ts` | `processNextPage` / `processReveal` 加 mode 分支;新增 `check_random` / `check_favorite` callback |
| `bot/handlers/start.ts` | `/start` 时发欢迎文本 + reply keyboard |
| `bot/manager/bot-manager.ts` | 注册 `bot.hears('🎲 随便看看' / '⭐ 我的收藏')` |
| `shared/types/settings.ts` | `SystemSettings.welcomeText: string` |
| `client/pages/Settings.tsx` | 加欢迎语 TextArea |

## 数据流

### 随便看看

```
用户点 🎲 随便看看
  → bot.hears 触发 handleRandomBrowse
  → 查 BotUser
  → ensureSubscribed(BotUser.inviteLinkId, ...) [position 不传,只查主频道]
     - 失败 → sendSubscriptionPrompt(..., callbackPrefix='check_random')
     - 成功 ↓
  → SELECT r.* FROM Resource r WHERE EXISTS(SELECT 1 FROM ContentBinding cb WHERE cb.resourceId = r.id)
     ORDER BY random() LIMIT 1
  → resetSession(botUserId, mode='single', payload={resourceId})
  → 过滤 isHidden mediaFiles
  → sendResource + buildContentKeyboard(
      contentButtons=null,    // 不带 binding 自定义按钮
      sessionId, nextIndex=undefined,  // 无翻页
      revealInfo (如果有 hidden),
      searchMoreUrl=undefined,         // 不带搜索更多
      favoriteInfo                     // 带收藏
    )
```

### 我的收藏

```
用户点 ⭐ 我的收藏
  → handleFavoriteBrowse
  → 查 BotUser
  → ensureSubscribed(...)
     - 失败 → sendSubscriptionPrompt(..., callbackPrefix='check_favorite')
  → favorites = loadFavoriteList(botUserId)  // ORDER BY createdAt DESC
     - 空 → ctx.reply('你还没收藏过任何资源,在资源消息上点 ⭐ 收藏')
  → resetSession(botUserId, mode='favorite', payload=null, currentIndex=0)
  → 发第一条:favorites[0].resource
  → keyboard 含: reveal? + ⭐ 收藏 + 🔍 搜索更多 + 下一页?(favorites.length > 1)
```

### 翻页 (callback `next:`)

```
processNextPage 调整:
  根据 session.mode:
    'link'     → loadContentBindings(botUser.inviteLinkId) 取序列
    'favorite' → loadFavoriteList(botUser.id) 取序列
    'single'   → 不应发生(无翻页按钮),记 warn 然后 return

  其余流程不变(广告插入对 favorite 模式同样适用,因为广告也由 inviteLinkId 决定)。

  越界处理:
    'link'     → endContent (SystemSetting,沿用现有)
    'favorite' → ctx.reply('你的收藏全部看完了 🎯')
```

### 展开 (callback `reveal:`)

```
processReveal 取"当前资源"改为按 session.mode:
  'link'     → contentBindings[currentIndex].resource
  'favorite' → favorites[currentIndex].resource
  'single'   → prisma.resource.findUnique({ id: session.payload.resourceId })
```

### 订阅 prompt 后的「我已完成」

新增 callback 分支:
- `check_random:{sessionId-占位}:0` → 重新跑 handleRandomBrowse(忽略 sessionId,因为 single 模式无 session 上下文要恢复)
- `check_favorite:{sessionId-占位}:0` → 重新跑 handleFavoriteBrowse

实际上 sessionId 字段可忽略,但保留 callback_data 三段格式以复用 `subscription-prompt.ts:buildPromptKeyboard`。占位用 0 即可。

## 错误处理

| 场景 | 处理 |
|---|---|
| 「随便看看」资源池为空(无任何 ContentBinding) | 回 `暂无可用资源,请稍后再试` |
| 「我的收藏」收藏为空 | 回 `你还没收藏过任何资源,在资源消息上点 ⭐ 收藏` |
| favorite 序列里某个 resource 被删除 | favorites 表 cascade,行已被清掉,不会出现 |
| favorite 翻页越界 | 发独立结束提示,completeSession |
| session 模式不识别 | 当作 link 处理(向前兼容) |
| 订阅检查失败 | 走对应 `check_random` / `check_favorite` callback prompt |

## 测试要点

`subscription-check.test.ts` 已覆盖订阅逻辑,这次主要测:
- `random-resource.ts` 随机查询能返回 ContentBinding 引用过的资源
- `favorite-list.ts` 按 createdAt desc 排序
- `getCurrentResourceFromSession` 各 mode 分支

不必跑 e2e,bot 行为靠手测验证。

## 代码量估算

| 类别 | 估算行数 |
|---|---|
| 新增 `random-resource.ts` | ~40 |
| 新增 `favorite-list.ts` | ~40 |
| 新增 `home-keyboard.ts` (2 个 handler) | ~200 |
| 修改 `session.ts` (扩展 + getCurrentResourceFromSession) | ~30 |
| 修改 `callback.ts` (mode 分支 + 新 callback) | ~80 |
| 修改 `start.ts` (welcome + reply keyboard) | ~10 |
| 修改 `bot-manager.ts` (hears 注册) | ~10 |
| 修改 `sender.ts` (buildHomeReplyKeyboard) | ~15 |
| 修改 `content.ts` (getWelcomeText) | ~5 |
| Schema | ~3 |
| shared types + client Settings | ~15 |
| 单元测试 | ~50 |
| **合计** | **~500 行**(新增 + 改动) |

中等规模,1 个 db push,1 次构建 + 部署。预计 1 个 PR 完成。

## 部署 checklist

- [ ] schema 同步:`prisma db push`(additive 字段,无数据迁移)
- [ ] shared / server / bot / client 全部 build
- [ ] PM2 重启 api-server + bot-runner
- [ ] 后台「系统设置」填欢迎语(可选,默认值即可)
- [ ] 手动验证:`/start` 看到 reply keyboard;点🎲 随便看看 收到 1 条资源;在资源上点 ⭐ 收藏,再点 ⭐ 我的收藏 看到这条
