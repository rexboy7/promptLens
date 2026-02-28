export class ShuffleBag<T> {
  private readonly keyFn: (item: T) => string;
  private itemsByKey = new Map<string, T>();
  private bag: string[] = [];
  private lastKey: string | null = null;

  constructor(items: T[], keyFn: (item: T) => string) {
    this.keyFn = keyFn;
    this.reset(items);
  }

  reset(items: T[]) {
    this.itemsByKey.clear();
    for (const item of items) {
      this.itemsByKey.set(this.keyFn(item), item);
    }
    this.bag = [];
    this.lastKey = null;
    this.refill();
  }

  update(items: T[]) {
    const nextKeys = new Set<string>();
    for (const item of items) {
      const key = this.keyFn(item);
      nextKeys.add(key);
      this.itemsByKey.set(key, item);
    }
    for (const key of Array.from(this.itemsByKey.keys())) {
      if (!nextKeys.has(key)) {
        this.itemsByKey.delete(key);
      }
    }
    if (this.bag.length > 0) {
      this.bag = this.bag.filter((key) => this.itemsByKey.has(key));
    }
    if (this.itemsByKey.size === 0) {
      this.bag = [];
      this.lastKey = null;
      return;
    }
    if (this.bag.length === 0) {
      this.refill();
    }
  }

  next(count = 1): T[] {
    if (count <= 0 || this.itemsByKey.size === 0) return [];
    const picks: T[] = [];
    for (let i = 0; i < count; i += 1) {
      if (this.bag.length === 0) {
        this.refill();
      }
      if (this.bag.length === 0) break;
      const key = this.bag.pop()!;
      this.lastKey = key;
      const item = this.itemsByKey.get(key);
      if (item) {
        picks.push(item);
      } else {
        i -= 1;
      }
    }
    return picks;
  }

  private refill() {
    if (this.itemsByKey.size === 0) return;
    this.bag = Array.from(this.itemsByKey.keys());
    this.shuffle(this.bag);
    if (
      this.lastKey &&
      this.bag.length > 1 &&
      this.bag[this.bag.length - 1] === this.lastKey
    ) {
      [this.bag[0], this.bag[this.bag.length - 1]] = [
        this.bag[this.bag.length - 1],
        this.bag[0],
      ];
    }
  }

  private shuffle(items: string[]) {
    for (let i = items.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
  }
}
