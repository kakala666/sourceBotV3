import prisma from './prisma';

export class SettingsService {
  static async getAll() {
    const settings = await prisma.systemSetting.findMany();
    const result: Record<string, any> = {};
    for (const s of settings) {
      result[s.key] = s.value;
    }
    return result;
  }

  static async batchUpdate(data: Record<string, any>) {
    const ops = Object.entries(data).map(([key, value]) =>
      prisma.systemSetting.upsert({
        where: { key },
        update: { value },
        create: { key, value },
      })
    );
    await prisma.$transaction(ops);
    return this.getAll();
  }
}
