// Light unless the person chose dark in the panel.
export function readDark(storage?: Pick<Storage, 'getItem'>): boolean {
  try { return storage?.getItem('theme') === 'dark'; }
  catch { return false; }
}
