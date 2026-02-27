# DEPLOY.md — 自动部署指令文档

> 本文档是写给 AI Agent 的部署指令，不是给人类阅读的操作手册。
> 你（Agent）需要按照以下步骤，在用户提供的远程服务器上完成项目的全自动部署。

## 前置条件

在开始之前，你需要向用户确认以下信息：

1. **服务器 IP**（必需）
2. **SSH 用户名**（必需，通常为 `root`）
3. **后台管理面板的访问端口**（可选，默认 `8080`）
4. **PostgreSQL 数据库密码**（可选，用户不提供则自动生成一个随机密码）
5. **后台管理员账号**（可选，默认 `admin`）
6. **后台管理员密码**（可选，默认 `admin123`）

默认假设：
- 通过 SSH 连接服务器，密钥已配置，无需密码
- 服务器为全新裸机（Ubuntu/Debian 系），无任何预装环境
- 部署目录为 `/opt/sourceBotV3`

## 第一步：安装系统依赖

通过 SSH 在服务器上执行以下命令，安装所有必要的系统软件。

```bash
apt update && apt install -y curl git nginx ffmpeg postgresql postgresql-contrib
```

说明：
- `curl`：用于下载 Node.js 安装脚本
- `git`：用于拉取项目代码
- `nginx`：反向代理，托管前端静态文件并转发 API 请求
- `ffmpeg`：视频处理（提取元数据、生成封面缩略图），同时会附带安装 `ffprobe`
- `postgresql`：数据库

## 第二步：安装 Node.js 和 pnpm

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
npm install -g pnpm pm2
```

验证安装：
```bash
node -v    # 应 >= 18.0.0
pnpm -v
pm2 -v
ffprobe -version  # 确认 ffprobe 可用
```

如果任何一项验证失败，停止部署并告知用户。

## 第三步：配置 PostgreSQL

启动 PostgreSQL 并创建数据库和用户。将下方 `YOUR_DB_PASSWORD` 替换为用户提供的密码，或自动生成一个随机密码（建议 16 位以上，包含字母和数字）。

```bash
systemctl enable postgresql
systemctl start postgresql

sudo -u postgres psql -c "CREATE USER sourcebotuser WITH PASSWORD 'YOUR_DB_PASSWORD';"
sudo -u postgres psql -c "CREATE DATABASE sourcebotv3 OWNER sourcebotuser;"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE sourcebotv3 TO sourcebotuser;"
```

记住生成的 DATABASE_URL 格式为：
```
postgresql://sourcebotuser:YOUR_DB_PASSWORD@localhost:5432/sourcebotv3?schema=public
```

## 第四步：拉取项目代码

```bash
git clone https://github.com/kakala666/sourceBotV3.git /opt/sourceBotV3
cd /opt/sourceBotV3
```

## 第五步：配置环境变量

基于 `.env.example` 创建 `.env` 文件。你需要自动生成一个 JWT_SECRET（随机字符串，32 位以上）。

```bash
cp .env.example .env
```

然后编辑 `.env`，写入以下内容：

```env
DATABASE_URL="postgresql://sourcebotuser:YOUR_DB_PASSWORD@localhost:5432/sourcebotv3?schema=public"
JWT_SECRET="自动生成的随机字符串"
PORT=3000
NODE_ENV=production
UPLOAD_DIR=/opt/sourceBotV3/uploads
```

注意：
- `UPLOAD_DIR` 必须使用绝对路径
- `NODE_ENV` 必须设为 `production`

## 第六步：安装依赖并构建

```bash
cd /opt/sourceBotV3
pnpm install
pnpm build
```

`pnpm build` 会按顺序构建 shared → server → bot → client 四个包。如果构建失败，检查错误日志并修复后重试。

## 第七步：初始化数据库

```bash
cd /opt/sourceBotV3
pnpm db:generate
npx prisma migrate deploy --schema=packages/server/prisma/schema.prisma
pnpm db:seed
```

说明：
- `db:generate`：生成 Prisma Client
- `migrate deploy`：在生产环境执行数据库迁移（如果没有 migrations 目录，改用 `npx prisma db push --schema=packages/server/prisma/schema.prisma`）
- `db:seed`：创建默认管理员账号和初始化系统设置

如果用户提供了自定义的管理员账号或密码，在执行 `db:seed` 之前，你需要修改 `packages/server/prisma/seed.ts` 文件中的 `username` 和密码明文（`admin123` 部分），替换为用户指定的值。修改后再执行 seed。

## 第八步：创建 uploads 目录

```bash
mkdir -p /opt/sourceBotV3/uploads
```

## 第九步：配置 Nginx

将项目自带的 nginx 配置文件复制到 Nginx 配置目录，并根据实际情况修改。

```bash
cp /opt/sourceBotV3/nginx.conf /etc/nginx/sites-available/sourcebotv3
ln -sf /etc/nginx/sites-available/sourcebotv3 /etc/nginx/sites-enabled/sourcebotv3
rm -f /etc/nginx/sites-enabled/default
```

然后编辑 `/etc/nginx/sites-available/sourcebotv3`，需要修改以下内容：

1. `listen` 端口改为用户指定的端口（默认 `8080`）
2. `root` 路径改为 `/opt/sourceBotV3/packages/client/dist`

最终配置应为：

```nginx
server {
    listen 8080;
    server_name _;

    location / {
        root /opt/sourceBotV3/packages/client/dist;
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 50m;
    }

    location /health {
        proxy_pass http://127.0.0.1:3000;
    }
}
```

验证并重启 Nginx：

```bash
nginx -t
systemctl enable nginx
systemctl restart nginx
```

如果 `nginx -t` 报错，检查配置文件语法后重试。

## 第十步：使用 PM2 启动服务

```bash
cd /opt/sourceBotV3
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

说明：
- `pm2 start`：启动 api-server 和 bot-runner 两个进程
- `pm2 save`：保存进程列表，服务器重启后自动恢复
- `pm2 startup`：生成开机自启脚本，执行它输出的命令

## 第十一步：验证部署

依次执行以下验证：

1. **检查进程状态**：
```bash
pm2 status
```
确认 `api-server` 和 `bot-runner` 状态均为 `online`。

2. **检查 API 健康**：
```bash
curl http://localhost:3000/health
```
应返回正常响应。

3. **检查 Nginx 代理**：
```bash
curl http://localhost:8080/api/health
```
应返回与上一步相同的响应。

4. **检查前端页面**：
```bash
curl -s http://localhost:8080 | head -5
```
应返回 HTML 内容（包含 `index.html`）。

5. **检查 PM2 日志是否有报错**：
```bash
pm2 logs --lines 20 --nostream
```
确认没有 ERROR 级别的日志。

如果以上全部通过，部署成功。告知用户：
- 后台访问地址：`http://服务器IP:端口`
- 管理员账号：用户指定的账号（默认 `admin`）
- 管理员密码：用户指定的密码（默认 `admin123`）
- 如果使用的是默认密码，建议用户登录后尽快修改

## 故障排查

如果某一步失败，按以下思路排查：

| 现象 | 可能原因 | 解决方式 |
|------|---------|---------|
| pnpm install 失败 | Node.js 版本过低 | 确认 node -v >= 18 |
| pnpm build 失败 | 缺少 prisma generate | 先执行 pnpm db:generate 再 build |
| migrate deploy 失败 | 无 migrations 目录 | 改用 `npx prisma db push --schema=packages/server/prisma/schema.prisma` |
| PM2 进程 errored | .env 配置错误 | 检查 pm2 logs，确认 DATABASE_URL 和 UPLOAD_DIR 正确 |
| Nginx 502 | API 服务未启动 | 检查 pm2 status，确认 api-server 为 online |
| 前端白屏 | dist 目录为空或路径错误 | 确认 pnpm build 成功，nginx root 路径正确 |
| 视频封面纯黑 | ffmpeg 未安装 | 执行 `apt install -y ffmpeg` |

## 更新部署

后续代码更新时，在服务器上执行：

```bash
cd /opt/sourceBotV3
git pull
pnpm install
pnpm build
pm2 restart all --update-env
```

如果数据库结构有变动，在 build 之前额外执行：

```bash
pnpm db:generate
npx prisma migrate deploy --schema=packages/server/prisma/schema.prisma
```
