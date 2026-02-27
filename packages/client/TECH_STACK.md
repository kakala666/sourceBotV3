# 管理后台技术栈

## 前端框架

- **React 18** — UI 框架，https://react.dev
- **Ant Design 5** — 企业级 UI 组件库（Layout、Table、Form、Menu 等），https://ant-design.antgroup.com
- **React Router v6** — 路由管理，https://reactrouter.com

## 状态管理

- **Zustand** — 轻量状态管理（登录态、全局状态），https://zustand.docs.pmnd.rs

## 构建工具

- **Vite** — 开发服务器 + 打包，https://vite.dev
- **TypeScript** — 类型安全

## HTTP 请求

- **Axios** — API 请求封装，带 JWT 拦截器

## 项目结构

```
packages/client/
├── src/
│   ├── components/    # 公共组件（Layout 等）
│   ├── pages/         # 页面组件（Bots、Resources、Contents 等）
│   ├── stores/        # Zustand 状态仓库
│   ├── services/      # API 请求封装
│   ├── router/        # 路由配置
│   └── main.tsx       # 入口
├── index.html
├── vite.config.ts
└── tsconfig.json
```
