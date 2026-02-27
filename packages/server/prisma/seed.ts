import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { BCRYPT_SALT_ROUNDS } from 'shared';

const prisma = new PrismaClient();

async function main() {
  const existing = await prisma.admin.findUnique({
    where: { username: 'admin' },
  });

  if (existing) {
    console.log('管理员账号已存在，跳过创建');
    return;
  }

  const hashedPassword = await bcrypt.hash('admin123', BCRYPT_SALT_ROUNDS);

  await prisma.admin.create({
    data: {
      username: 'admin',
      password: hashedPassword,
    },
  });

  console.log('默认管理员账号创建成功：admin / admin123');

  // 初始化系统设置
  const settings = [
    {
      key: 'endContent',
      value: { text: '预览已结束，感谢观看！', buttons: [] },
    },
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
