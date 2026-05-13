/** 格式化为 Asia/Shanghai 时区下的 YYYY-MM-DD */
export function formatShanghaiDate(d: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}
