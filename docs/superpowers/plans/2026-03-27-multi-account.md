# Multi-Account Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add multi-account admin management with permission-based access control.

**Architecture:** Extend Admin model with new fields, add CRUD API with permission middleware, add frontend management page conditionally visible to privileged admins.

**Tech Stack:** Prisma, Express, React, Ant Design, Zustand, bcryptjs

---

### Task 1: Database Schema & Migration

**Files:**
- Modify: `packages/server/prisma/schema.prisma` (Admin model)
- Modify: `packages/server/prisma/seed.ts`

- [ ] **Step 1: Update Admin model in schema.prisma**

Replace the current Admin model:

```prisma
model Admin {
  id                Int      @id @default(autoincrement())
  name              String
  username          String   @unique
  password          String
  telegramId        String?  @unique
  canManageAccounts Boolean  @default(false)
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
}
```

- [ ] **Step 2: Create and apply migration**

```bash
cd packages/server && npx prisma migrate dev --name add_admin_fields
```

- [ ] **Step 3: Update seed script**

Replace `packages/server/prisma/seed.ts`:

```typescript
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { BCRYPT_SALT_ROUNDS } from 'shared';

const prisma = new PrismaClient();

async function main() {
  const hashedPassword = await bcrypt.hash('admin123', BCRYPT_SALT_ROUNDS);

  await prisma.admin.upsert({
    where: { username: 'admin' },
    update: { canManageAccounts: true, name: '超级管理员' },
    create: {
      name: '超级管理员',
      username: 'admin',
      password: hashedPassword,
      canManageAccounts: true,
    },
  });

  console.log('默认管理员账号已就绪：admin / admin123（首次创建时）');

  const settings = [
    { key: 'endContent', value: { text: '预览已结束，感谢观看！', buttons: [] } },
    { key: 'adDisplaySeconds', value: 5 },
    { key: 'statsGroupId', value: '' },
  ];

  for (const setting of settings) {
    await prisma.systemSetting.upsert({
      where: { key: setting.key },
      update: { value: setting.value },
      create: { key: setting.key, value: setting.value },
    });
  }

  console.log('系统默认设置初始化完成');
}

main()
  .catch((e) => {
    console.error('种子脚本执行失败:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
```

- [ ] **Step 4: Run seed to update existing admin**

```bash
cd packages/server && npx prisma db seed
```

- [ ] **Step 5: Commit**

```bash
git add packages/server/prisma/schema.prisma packages/server/prisma/seed.ts packages/server/prisma/migrations/
git commit -m "feat(db): add admin multi-account fields (name, telegramId, canManageAccounts)"
```

---

### Task 2: Shared Types

**Files:**
- Modify: `packages/shared/src/types/auth.ts`
- Create: `packages/shared/src/types/admin.ts`
- Modify: `packages/shared/src/types/index.ts`

- [ ] **Step 1: Update auth types**

Replace `packages/shared/src/types/auth.ts`:

```typescript
// 认证相关类型
export interface LoginInput {
  username: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  admin: AdminInfo;
}

export interface AdminInfo {
  id: number;
  name: string;
  username: string;
  telegramId: string | null;
  canManageAccounts: boolean;
}
```

- [ ] **Step 2: Create admin CRUD types**

Create `packages/shared/src/types/admin.ts`:

```typescript
export interface AdminCreateInput {
  name: string;
  username: string;
  password: string;
  telegramId?: string;
  canManageAccounts?: boolean;
}

export interface AdminUpdateInput {
  name?: string;
  username?: string;
  password?: string;
  telegramId?: string | null;
  canManageAccounts?: boolean;
}
```

- [ ] **Step 3: Export from index**

In `packages/shared/src/types/index.ts`, add:

```typescript
export * from './admin';
```

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/types/
git commit -m "feat(shared): add multi-account admin types"
```

---

### Task 3: Backend - Permission Middleware & Admin Service

**Files:**
- Create: `packages/server/src/middleware/permission.ts`
- Create: `packages/server/src/services/admin.service.ts`

- [ ] **Step 1: Create permission middleware**

Create `packages/server/src/middleware/permission.ts`:

```typescript
import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth';
import { fail } from '../utils/response';
import prisma from '../services/prisma';

export async function requireAccountManager(req: AuthRequest, res: Response, next: NextFunction) {
  const admin = await prisma.admin.findUnique({
    where: { id: req.adminId },
    select: { canManageAccounts: true },
  });

  if (!admin?.canManageAccounts) {
    return fail(res, '无账号管理权限', 403);
  }

  next();
}
```

- [ ] **Step 2: Create admin service**

Create `packages/server/src/services/admin.service.ts`:

```typescript
import bcrypt from 'bcryptjs';
import prisma from './prisma';
import { BCRYPT_SALT_ROUNDS } from 'shared';
import type { AdminCreateInput, AdminUpdateInput } from 'shared';

const adminSelect = {
  id: true,
  name: true,
  username: true,
  telegramId: true,
  canManageAccounts: true,
  createdAt: true,
  updatedAt: true,
};

export class AdminService {
  static async list() {
    return prisma.admin.findMany({
      select: adminSelect,
      orderBy: { id: 'asc' },
    });
  }

  static async create(input: AdminCreateInput) {
    const hashedPassword = await bcrypt.hash(input.password, BCRYPT_SALT_ROUNDS);
    return prisma.admin.create({
      data: {
        name: input.name,
        username: input.username,
        password: hashedPassword,
        telegramId: input.telegramId || null,
        canManageAccounts: input.canManageAccounts ?? false,
      },
      select: adminSelect,
    });
  }

  static async update(id: number, input: AdminUpdateInput) {
    const data: any = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.username !== undefined) data.username = input.username;
    if (input.telegramId !== undefined) data.telegramId = input.telegramId || null;
    if (input.canManageAccounts !== undefined) data.canManageAccounts = input.canManageAccounts;
    if (input.password) {
      data.password = await bcrypt.hash(input.password, BCRYPT_SALT_ROUNDS);
    }

    return prisma.admin.update({
      where: { id },
      data,
      select: adminSelect,
    });
  }

  static async delete(id: number) {
    await prisma.admin.delete({ where: { id } });
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/middleware/permission.ts packages/server/src/services/admin.service.ts
git commit -m "feat(server): add admin service and permission middleware"
```

---

### Task 4: Backend - Admin Routes & Auth Updates

**Files:**
- Create: `packages/server/src/routes/admins.ts`
- Modify: `packages/server/src/routes/index.ts`
- Modify: `packages/server/src/services/auth.service.ts`

- [ ] **Step 1: Create admin routes**

Create `packages/server/src/routes/admins.ts`:

```typescript
import { Router, type IRouter } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { requireAccountManager } from '../middleware/permission';
import { AdminService } from '../services/admin.service';
import { success, fail } from '../utils/response';

const router: IRouter = Router();
router.use(authMiddleware);
router.use(requireAccountManager);

router.get('/', async (_req, res) => {
  try {
    const admins = await AdminService.list();
    return success(res, admins);
  } catch (err: any) {
    return fail(res, err.message, 500);
  }
});

router.post('/', async (req, res) => {
  try {
    const { name, username, password, telegramId, canManageAccounts } = req.body;
    if (!name || !username || !password) {
      return fail(res, '姓名、账号和密码不能为空');
    }
    const admin = await AdminService.create({ name, username, password, telegramId, canManageAccounts });
    return success(res, admin, 201);
  } catch (err: any) {
    if (err.code === 'P2002') {
      const field = err.meta?.target?.includes('username') ? '账号' : 'Telegram ID';
      return fail(res, `${field}已存在`, 409);
    }
    return fail(res, err.message, 500);
  }
});

router.put('/:id', async (req: AuthRequest, res) => {
  try {
    const id = parseInt(req.params.id);
    const { name, username, password, telegramId, canManageAccounts } = req.body;

    // 不可关闭自己的管理权限
    if (id === req.adminId && canManageAccounts === false) {
      return fail(res, '不可关闭自己的账号管理权限', 403);
    }

    const admin = await AdminService.update(id, { name, username, password, telegramId, canManageAccounts });
    return success(res, admin);
  } catch (err: any) {
    if (err.code === 'P2002') {
      const field = err.meta?.target?.includes('username') ? '账号' : 'Telegram ID';
      return fail(res, `${field}已存在`, 409);
    }
    if (err.code === 'P2025') return fail(res, '账号不存在', 404);
    return fail(res, err.message, 500);
  }
});

router.delete('/:id', async (req: AuthRequest, res) => {
  try {
    const id = parseInt(req.params.id);
    if (id === req.adminId) {
      return fail(res, '不可删除自己的账号', 403);
    }
    await AdminService.delete(id);
    return success(res);
  } catch (err: any) {
    if (err.code === 'P2025') return fail(res, '账号不存在', 404);
    return fail(res, err.message, 500);
  }
});

export default router;
```

- [ ] **Step 2: Register admin routes**

In `packages/server/src/routes/index.ts`, add import and route:

```typescript
import adminsRouter from './admins';
```

Add before `export default router`:

```typescript
router.use('/admins', adminsRouter);
```

- [ ] **Step 3: Update auth service to return new fields**

Replace `packages/server/src/services/auth.service.ts`:

```typescript
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from './prisma';
import { JWT_EXPIRES_IN } from 'shared';

export class AuthService {
  static async login(username: string, password: string) {
    const admin = await prisma.admin.findUnique({ where: { username } });
    if (!admin) return null;

    const valid = await bcrypt.compare(password, admin.password);
    if (!valid) return null;

    const secret = process.env.JWT_SECRET || 'default-secret';
    const token = jwt.sign(
      { id: admin.id, username: admin.username },
      secret,
      { expiresIn: JWT_EXPIRES_IN }
    );

    return {
      token,
      admin: {
        id: admin.id,
        name: admin.name,
        username: admin.username,
        telegramId: admin.telegramId,
        canManageAccounts: admin.canManageAccounts,
      },
    };
  }

  static async getMe(adminId: number) {
    return prisma.admin.findUnique({
      where: { id: adminId },
      select: {
        id: true,
        name: true,
        username: true,
        telegramId: true,
        canManageAccounts: true,
      },
    });
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/routes/admins.ts packages/server/src/routes/index.ts packages/server/src/services/auth.service.ts
git commit -m "feat(server): add admin CRUD routes and update auth responses"
```

---

### Task 5: Frontend - Auth Store & Layout Updates

**Files:**
- Modify: `packages/client/src/stores/auth.ts`
- Modify: `packages/client/src/components/Layout.tsx`

- [ ] **Step 1: Update Layout with conditional admin menu**

In `packages/client/src/components/Layout.tsx`:

Add `UserSwitchOutlined` to the icon imports:

```typescript
import {
  RobotOutlined,
  FileImageOutlined,
  AppstoreOutlined,
  NotificationOutlined,
  TeamOutlined,
  BarChartOutlined,
  SettingOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  UserSwitchOutlined,
} from '@ant-design/icons';
```

Replace the static `menuItems` array and update the component to compute menu items dynamically:

```typescript
export default function Layout() {
  const [collapsed, setCollapsed] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { admin, logout } = useAuthStore();
  const { token: { colorBgContainer, borderRadiusLG } } = theme.useToken();

  const menuItems = [
    { key: '/bots', icon: <RobotOutlined />, label: '机器人管理' },
    { key: '/resources', icon: <FileImageOutlined />, label: '资源管理' },
    { key: '/contents', icon: <AppstoreOutlined />, label: '内容配置' },
    { key: '/ads', icon: <NotificationOutlined />, label: '广告配置' },
    { key: '/users', icon: <TeamOutlined />, label: '用户列表' },
    { key: '/stats', icon: <BarChartOutlined />, label: '统计报表' },
    { key: '/settings', icon: <SettingOutlined />, label: '系统设置' },
    ...(admin?.canManageAccounts
      ? [{ key: '/admins', icon: <UserSwitchOutlined />, label: '账号管理' }]
      : []),
  ];
```

Also update the header display from `admin?.username` to `admin?.name`:

```typescript
<span>管理员：{admin?.name || admin?.username}</span>
```

- [ ] **Step 2: Commit**

```bash
git add packages/client/src/stores/auth.ts packages/client/src/components/Layout.tsx
git commit -m "feat(client): conditional admin menu and auth store updates"
```

---

### Task 6: Frontend - Admin Management Page & Routing

**Files:**
- Create: `packages/client/src/pages/Admins.tsx`
- Modify: `packages/client/src/App.tsx`

- [ ] **Step 1: Create Admins page**

Create `packages/client/src/pages/Admins.tsx`:

```tsx
import { useEffect, useState, useCallback } from 'react';
import {
  Table, Button, Modal, Form, Input, Switch, Space, message, Popconfirm, Typography, Tag,
} from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import type { AdminInfo, AdminCreateInput, ApiResponse } from 'shared';
import { useAuthStore } from '@/stores/auth';
import api from '@/services/api';

const { Title } = Typography;

export default function Admins() {
  const [admins, setAdmins] = useState<AdminInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<AdminInfo | null>(null);
  const [form] = Form.useForm<AdminCreateInput & { password?: string }>();
  const currentAdminId = useAuthStore((s) => s.admin?.id);

  const fetchAdmins = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get<ApiResponse<AdminInfo[]>>('/admins');
      setAdmins(data.data || []);
    } catch {
      message.error('获取账号列表失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAdmins(); }, [fetchAdmins]);

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      if (editing) {
        if (!values.password) delete values.password;
        await api.put(`/admins/${editing.id}`, values);
        message.success('更新成功');
      } else {
        await api.post('/admins', values);
        message.success('创建成功');
      }
      setModalOpen(false);
      form.resetFields();
      setEditing(null);
      fetchAdmins();
    } catch (err: any) {
      const msg = err.response?.data?.message || '操作失败';
      message.error(msg);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await api.delete(`/admins/${id}`);
      message.success('删除成功');
      fetchAdmins();
    } catch (err: any) {
      const msg = err.response?.data?.message || '删除失败';
      message.error(msg);
    }
  };

  const openEdit = (admin: AdminInfo) => {
    setEditing(admin);
    form.setFieldsValue({
      name: admin.name,
      username: admin.username,
      telegramId: admin.telegramId || undefined,
      canManageAccounts: admin.canManageAccounts,
    });
    setModalOpen(true);
  };

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    setModalOpen(true);
  };

  const columns = [
    { title: '姓名', dataIndex: 'name', key: 'name' },
    { title: '账号', dataIndex: 'username', key: 'username' },
    {
      title: 'Telegram ID',
      dataIndex: 'telegramId',
      key: 'telegramId',
      render: (v: string | null) => v || '-',
    },
    {
      title: '账号管理权限',
      dataIndex: 'canManageAccounts',
      key: 'canManageAccounts',
      render: (v: boolean) => v ? <Tag color="blue">有权限</Tag> : <Tag>无权限</Tag>,
    },
    {
      title: '操作',
      key: 'actions',
      render: (_: unknown, record: AdminInfo) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(record)}>
            编辑
          </Button>
          {record.id !== currentAdminId && (
            <Popconfirm title="确定删除该账号？" onConfirm={() => handleDelete(record.id)}>
              <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>账号管理</Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          新增账号
        </Button>
      </div>
      <Table rowKey="id" columns={columns} dataSource={admins} loading={loading} pagination={false} />
      <Modal
        title={editing ? '编辑账号' : '新增账号'}
        open={modalOpen}
        onOk={handleSubmit}
        onCancel={() => { setModalOpen(false); setEditing(null); form.resetFields(); }}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="姓名" rules={[{ required: true, message: '请输入姓名' }]}>
            <Input placeholder="管理员姓名" />
          </Form.Item>
          <Form.Item name="username" label="账号" rules={[{ required: true, message: '请输入账号' }]}>
            <Input placeholder="登录账号" />
          </Form.Item>
          <Form.Item
            name="password"
            label={editing ? '密码（留空则不修改）' : '密码'}
            rules={editing ? [] : [{ required: true, message: '请输入密码' }]}
          >
            <Input.Password placeholder={editing ? '留空则不修改' : '登录密码'} />
          </Form.Item>
          <Form.Item name="telegramId" label="Telegram ID">
            <Input placeholder="可选，用户的 Telegram ID" />
          </Form.Item>
          <Form.Item name="canManageAccounts" label="账号管理权限" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
```

- [ ] **Step 2: Add route in App.tsx**

In `packages/client/src/App.tsx`, add import:

```typescript
import Admins from '@/pages/Admins';
```

Add route in the children array (after `settings`):

```typescript
{ path: 'admins', element: <Admins /> },
```

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/pages/Admins.tsx packages/client/src/App.tsx
git commit -m "feat(client): add admin management page and routing"
```

---

### Task 7: Build Verification & Final Commit

- [ ] **Step 1: Build shared package**

```bash
cd packages/shared && pnpm build
```

Expected: No errors.

- [ ] **Step 2: Build server package**

```bash
cd packages/server && npx prisma generate && pnpm build
```

Expected: No errors.

- [ ] **Step 3: Build client package**

```bash
cd packages/client && pnpm build
```

Expected: No errors.

- [ ] **Step 4: Fix any build errors and commit**

If there are build errors, fix them and commit the fixes.
