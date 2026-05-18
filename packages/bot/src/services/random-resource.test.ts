import { strict as assert } from 'node:assert';
import { pickRandomContentResource, _setPrismaForTests } from './random-resource';

(async () => {
  // case 1: 资源池为空 → null
  _setPrismaForTests({
    $queryRaw: async () => [],
    resource: { findUnique: async () => null },
  });
  let r = await pickRandomContentResource();
  assert.equal(r, null);

  // case 2: 抽到 1 条 → 返回带 mediaFiles
  _setPrismaForTests({
    $queryRaw: async () => [{ id: 42 }],
    resource: {
      findUnique: async ({ where }: any) => {
        assert.equal(where.id, 42);
        return { id: 42, type: 'photo', caption: 'x', mediaFiles: [{ id: 1 }] };
      },
    },
  });
  r = await pickRandomContentResource();
  assert.equal(r?.id, 42);
  assert.equal(r?.mediaFiles.length, 1);

  console.log('✓ pickRandomContentResource tests passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
