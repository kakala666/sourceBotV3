import { strict as assert } from 'node:assert';
import { extractFileId } from './media-fileid';

// photo: 取最大尺寸(数组最后一个)
assert.equal(
  extractFileId({ photo: [{ file_id: 'a' }, { file_id: 'b' }] }, 'photo'),
  'b',
);
// video
assert.equal(extractFileId({ video: { file_id: 'v1' } }, 'video'), 'v1');
// document 兜底(任何 type 只要带 document)
assert.equal(extractFileId({ document: { file_id: 'd1' } }, 'photo'), 'd1');
// 空消息 → null
assert.equal(extractFileId({}, 'photo'), null);
// 缺字段不抛
assert.equal(extractFileId(null, 'photo'), null);

console.log('✓ extractFileId tests passed');
