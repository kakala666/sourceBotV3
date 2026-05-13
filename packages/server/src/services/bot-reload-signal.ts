import fs from 'fs';
import path from 'path';

const SIGNAL_FILE = path.resolve(__dirname, '../../../../.bot-reload');

export function touchReloadSignal(): void {
  try {
    fs.writeFileSync(SIGNAL_FILE, String(Date.now()));
  } catch (err: any) {
    console.error('[bot-reload-signal] 写信号文件失败:', err.message);
  }
}
