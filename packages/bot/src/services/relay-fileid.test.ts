import { strict as assert } from 'node:assert';
import {
  fetchFileIdViaRelay,
  _setRelayGroupIdCacheForTests,
} from './relay-fileid';

const noSleep = async () => {};

(async () => {
  // case 1: 未配置中转群 → 直接 null,不调 api
  _setRelayGroupIdCacheForTests(null);
  let called = false;
  const r1 = await fetchFileIdViaRelay(
    { forwardMessage: async () => { called = true; return {}; }, deleteMessage: async () => true },
    -100n, 5, 'photo', noSleep,
  );
  assert.equal(r1, null);
  assert.equal(called, false, '未配置时不应调 forwardMessage');

  // case 2: 正常转发 → 抓到 file_id,并删除中转消息
  _setRelayGroupIdCacheForTests('-100999');
  let deletedMsgId: number | null = null;
  const r2 = await fetchFileIdViaRelay(
    {
      forwardMessage: async (chatId: any, fromChatId: any, msgId: any) => {
        assert.equal(chatId, '-100999');
        assert.equal(fromChatId, -100);   // BigInt(-100) → Number
        assert.equal(msgId, 5);
        return { message_id: 777, photo: [{ file_id: 'p_small' }, { file_id: 'p_big' }] };
      },
      deleteMessage: async (_c: any, mid: number) => { deletedMsgId = mid; return true; },
    },
    -100n, 5, 'photo', noSleep,
  );
  assert.equal(r2, 'p_big');
  assert.equal(deletedMsgId, 777, '应删除中转消息');

  // case 3: 首次 429 → 等待后重试成功
  _setRelayGroupIdCacheForTests('-100999');
  let attempts = 0;
  const r3 = await fetchFileIdViaRelay(
    {
      forwardMessage: async () => {
        attempts++;
        if (attempts === 1) {
          const e: any = new Error('Too Many Requests');
          e.parameters = { retry_after: 1 };
          throw e;
        }
        return { message_id: 1, video: { file_id: 'v_ok' } };
      },
      deleteMessage: async () => true,
    },
    -100n, 9, 'video', noSleep,
  );
  assert.equal(r3, 'v_ok');
  assert.equal(attempts, 2, '应重试一次');

  // case 4: 非 429 错误 → null(触发回退),不抛
  _setRelayGroupIdCacheForTests('-100999');
  const r4 = await fetchFileIdViaRelay(
    {
      forwardMessage: async () => { throw new Error('message to forward not found'); },
      deleteMessage: async () => true,
    },
    -100n, 404, 'photo', noSleep,
  );
  assert.equal(r4, null);

  console.log('✓ relay-fileid tests passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
