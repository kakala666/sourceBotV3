import { strict as assert } from 'node:assert';
import { loadFavoriteList, _setPrismaForTests } from './favorite-list';

(async () => {
  // case 1: 空 → []
  _setPrismaForTests({
    favoriteResource: { findMany: async () => [] },
  });
  let r = await loadFavoriteList(1);
  assert.deepEqual(r, []);

  // case 2: 3 条 → 顺序 + 形状
  _setPrismaForTests({
    favoriteResource: {
      findMany: async ({ where, orderBy }: any) => {
        assert.equal(where.botUserId, 7);
        assert.equal(orderBy.createdAt, 'desc');
        return [
          { resource: { id: 100, type: 'photo', mediaFiles: [] } },
          { resource: { id: 99, type: 'video', mediaFiles: [{ id: 1 }] } },
          { resource: { id: 98, type: 'media_group', mediaFiles: [] } },
        ];
      },
    },
  });
  r = await loadFavoriteList(7);
  assert.equal(r.length, 3);
  assert.equal(r[0].resource.id, 100);
  assert.equal(r[0].sortOrder, 0);
  assert.equal(r[2].sortOrder, 2);
  assert.equal(r[0].buttons, null);

  console.log('✓ loadFavoriteList tests passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
