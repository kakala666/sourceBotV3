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
    { key: 'centralAuthEnabled', value: false },
    { key: 'verifyCodeEnabled', value: false },
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
