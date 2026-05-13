import { strict as assert } from 'node:assert';
import { formatShanghaiDate } from './local-date';

// UTC 2026-05-13 15:30 → 上海时间 2026-05-13 23:30
assert.equal(formatShanghaiDate(new Date('2026-05-13T15:30:00Z')), '2026-05-13');

// UTC 17:00 → 上海 01:00 第二天
assert.equal(formatShanghaiDate(new Date('2026-05-13T17:00:00Z')), '2026-05-14');

// 跨年:UTC 2025-12-31 16:00 → 上海 2026-01-01 00:00
assert.equal(formatShanghaiDate(new Date('2025-12-31T16:00:00Z')), '2026-01-01');

console.log('✓ formatShanghaiDate tests passed');
