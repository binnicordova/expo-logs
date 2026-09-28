import { WebStorage } from '../storage/index.web';

class FakeLocalStorage implements Storage {
  private data = new Map<string, string>();
  constructor(private quota = Infinity) {}
  get length() {
    return this.data.size;
  }
  key(i: number) {
    return Array.from(this.data.keys())[i] ?? null;
  }
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    let used = 0;
    this.data.forEach((value, key) => {
      if (key !== k) used += value.length;
    });
    if (used + v.length > this.quota) {
      const error = new Error('quota');
      error.name = 'QuotaExceededError';
      throw error;
    }
    this.data.set(k, v);
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
  clear() {
    this.data.clear();
  }
}

describe('WebStorage', () => {
  it('appends, lists, reads and removes files in a namespace', async () => {
    const storage = new WebStorage(new FakeLocalStorage());
    await storage.setDirectory('logs');
    await storage.append('a.log', 'one\n');
    await storage.append('a.log', 'two\n');
    const files = await storage.list();
    expect(files.map((f) => [f.name, f.size, f.uri])).toEqual([
      ['a.log', 8, 'expo-logs://logs/a.log'],
    ]);
    expect(await storage.read('a.log')).toBe('one\ntwo\n');
    await storage.remove('a.log');
    expect(await storage.list()).toEqual([]);
  });

  it('drops the oldest file when the quota is exceeded', async () => {
    const storage = new WebStorage(new FakeLocalStorage(60));
    await storage.setDirectory('logs');
    await storage.append('1.log', 'x'.repeat(30));
    await storage.append('2.log', 'y'.repeat(30));
    const names = (await storage.list()).map((f) => f.name);
    expect(names).toEqual(['2.log']);
  });
});
