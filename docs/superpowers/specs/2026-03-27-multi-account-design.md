# Multi-Account Support Design

## Overview

Extend the single-admin system to support multiple admin accounts with account management permissions. Accounts cannot self-register; they must be created by an admin with `canManageAccounts` privilege.

## Database Changes

### Admin Table (Modified)

```prisma
model Admin {
  id                Int      @id @default(autoincrement())
  name              String                    // Display name (required)
  username          String   @unique          // Login username (required)
  password          String                    // bcrypt hashed password
  telegramId        String?  @unique          // Telegram user ID (optional)
  canManageAccounts Boolean  @default(false)  // Account management permission
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
}
```

New fields: `name`, `telegramId`, `canManageAccounts`.

`telegramId` is `String?` (optional, unique when present) for easy frontend handling.

### Migration

Add new columns with defaults so existing rows survive:
- `name` defaults to `'Admin'`
- `telegramId` defaults to `null`
- `canManageAccounts` defaults to `false`

Seed script updates the default admin to `canManageAccounts: true` and `name: '超级管理员'`.

## API Changes

### Modified Endpoints

**POST /api/auth/login** — Response now includes `canManageAccounts`:
```json
{
  "token": "...",
  "admin": { "id": 1, "username": "admin", "name": "超级管理员", "canManageAccounts": true }
}
```

**GET /api/auth/me** — Same addition.

JWT payload unchanged (`{ id, username }`); `canManageAccounts` is fetched from DB per request in the admin routes.

### New Endpoints: `/api/admins`

All require authentication + `canManageAccounts === true`. Returns 403 otherwise.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/admins` | List all admins (excludes password) |
| POST | `/api/admins` | Create admin account |
| PUT | `/api/admins/:id` | Update admin (password blank = no change) |
| DELETE | `/api/admins/:id` | Delete admin (cannot delete self) |

**POST /api/admins** request body:
```json
{
  "name": "张三",
  "username": "zhangsan",
  "password": "secure123",
  "telegramId": "123456789",
  "canManageAccounts": false
}
```

**PUT /api/admins/:id** request body (all fields optional):
```json
{
  "name": "张三",
  "username": "zhangsan",
  "password": "",
  "telegramId": "123456789",
  "canManageAccounts": true
}
```

**Safety constraints:**
- Cannot delete yourself (prevents lockout)
- Cannot revoke your own `canManageAccounts` (prevents no-admin state)
- Password is never returned in any response
- Username uniqueness enforced at DB level
- TelegramId uniqueness enforced at DB level

### Permission Middleware

New `requireAccountManager` middleware:
1. Reads `adminId` from request (set by existing `authMiddleware`)
2. Queries DB for `canManageAccounts`
3. Returns 403 if `false`

## Shared Types Changes

### `packages/shared/src/types/auth.ts`

```typescript
export interface AdminInfo {
  id: number;
  name: string;
  username: string;
  telegramId: string | null;
  canManageAccounts: boolean;
}
```

### New: `packages/shared/src/types/admin.ts`

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

## Frontend Changes

### Auth Store

`AdminInfo` in Zustand store now includes `canManageAccounts`. Used to conditionally render the admin management menu item.

### New Page: Account Management (`/admins`)

- Ant Design `Table` with columns: name, username, telegramId, canManageAccounts, actions
- Create/Edit via `Modal` with form
- Delete with confirmation
- Password field in edit mode: empty = no change, filled = update

### Layout / Sidebar

- "Account Management" menu item visible only when `canManageAccounts === true`
- Icon: `TeamOutlined` or `UserOutlined`

### Routing

- New route `/admins` in `App.tsx`, inside AuthGuard

## Seed Script Changes

```typescript
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
```

## Files to Create/Modify

### New Files
- `packages/shared/src/types/admin.ts` — Admin CRUD types
- `packages/server/src/routes/admins.ts` — Admin CRUD routes
- `packages/server/src/services/admin.service.ts` — Admin business logic
- `packages/server/src/middleware/permission.ts` — `requireAccountManager` middleware
- `packages/client/src/pages/Admins.tsx` — Account management page

### Modified Files
- `packages/server/prisma/schema.prisma` — Admin model fields
- `packages/shared/src/types/auth.ts` — AdminInfo extended
- `packages/shared/src/types/index.ts` — Export new admin types
- `packages/server/src/routes/index.ts` — Register `/api/admins` route
- `packages/server/src/services/auth.service.ts` — Return new fields
- `packages/server/prisma/seed.ts` — Update seed logic
- `packages/client/src/stores/auth.ts` — Store `canManageAccounts`
- `packages/client/src/components/Layout.tsx` — Conditional menu item
- `packages/client/src/App.tsx` — Add `/admins` route
