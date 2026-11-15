import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

// Real Git commits, trees and refs, kept compact so large fixtures exercise
// pagination rather than exceeding the independent private-state entry cap.
export async function seedTrash(store, count = 1001) {
  const history = store.recovery, input = 'fixture-trash.md', text = '\uFEFFsynthetic trash\r\n';
  const version = createHash('sha256').update(text).digest('hex');
  const marksPath = path.join(history.stateRoot, 'fixture-marks');
  let stream = `blob\nmark :1\ndata ${Buffer.byteLength(text)}\n${text}\n`;
  for (let i = 0; i < count; i++) {
    const metadata = JSON.stringify({ format: 1, path: input, version, time: new Date(1700000000000 + i).toISOString(), operation: 'trash' });
    stream += `commit ${history.ref(input)}\nmark :${i + 2}\ncommitter Corilo <notes@localhost> ${1700000000 + i} +0000\ndata ${Buffer.byteLength(metadata)}\n${metadata}\nM 100644 :1 note\n\n`;
  }
  await history.run(['fast-import', '--quiet', `--export-marks=${marksPath}`], stream, 256);
  const ids = (await fs.readFile(marksPath, 'utf8')).trim().split('\n').filter(line => !line.startsWith(':1 ')).map(line => line.split(' ')[1]);
  await fs.unlink(marksPath);
  await history.run(['update-ref', '--stdin'], ids.map(id => `create refs/corilo/trash/${id} ${id}`).join('\n') + '\n', 256);
  await history.run(['pack-refs', '--all'], undefined, 256);
  return { ids: ids.sort(), path: input, text, version };
}
