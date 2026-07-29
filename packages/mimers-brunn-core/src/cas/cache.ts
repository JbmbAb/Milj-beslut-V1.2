interface CacheNode<K, V> {
  key: K;
  value: V;
  weight: number;
  prev: CacheNode<K, V> | null;
  next: CacheNode<K, V> | null;
}

/** Byte-weighted LRU cache with O(1) get/set/evict. */
export class WeightedLRUCache<K extends string, V> {
  private cache = new Map<K, CacheNode<K, V>>();
  private head: CacheNode<K, V> | null = null;
  private tail: CacheNode<K, V> | null = null;
  private currentWeight = 0;

  constructor(
    private readonly maxWeight: number,
    private readonly weightOf: (value: V) => number,
  ) {}

  get size(): number {
    return this.cache.size;
  }

  getWeight(): number {
    return this.currentWeight;
  }

  get(key: K): V | undefined {
    const node = this.cache.get(key);
    if (!node) return undefined;
    this.moveToHead(node);
    return node.value;
  }

  set(key: K, value: V): void {
    const weight = this.weightOf(value);
    const existingNode = this.cache.get(key);

    if (existingNode) {
      this.currentWeight -= existingNode.weight;
      existingNode.value = value;
      existingNode.weight = weight;
      this.currentWeight += weight;
      this.moveToHead(existingNode);
      this.enforceWeightLimit();
      return;
    }

    const newNode: CacheNode<K, V> = { key, value, weight, prev: null, next: null };
    this.cache.set(key, newNode);
    this.addToHead(newNode);
    this.currentWeight += weight;
    this.enforceWeightLimit();
  }

  has(key: K): boolean {
    return this.cache.has(key);
  }

  delete(key: K): boolean {
    const node = this.cache.get(key);
    if (!node) return false;
    this.currentWeight -= node.weight;
    this.cache.delete(key);
    this.removeNodeRefs(node);
    return true;
  }

  clear(): void {
    this.cache.clear();
    this.head = null;
    this.tail = null;
    this.currentWeight = 0;
  }

  private moveToHead(node: CacheNode<K, V>): void {
    if (node === this.head) return;
    this.removeNodeRefs(node);
    this.addToHead(node);
  }

  private addToHead(node: CacheNode<K, V>): void {
    node.next = this.head;
    node.prev = null;
    if (this.head) this.head.prev = node;
    this.head = node;
    if (!this.tail) this.tail = node;
  }

  private removeNodeRefs(node: CacheNode<K, V>): void {
    if (node.prev) node.prev.next = node.next;
    if (node.next) node.next.prev = node.prev;
    if (node === this.tail) this.tail = node.prev;
    if (node === this.head) this.head = node.next;
    node.prev = null;
    node.next = null;
  }

  private enforceWeightLimit(): void {
    while (this.currentWeight > this.maxWeight && this.tail) {
      this.evictTail();
    }
  }

  private evictTail(): void {
    if (!this.tail) return;
    const toRemove = this.tail;
    this.currentWeight -= toRemove.weight;
    this.cache.delete(toRemove.key);
    this.removeNodeRefs(toRemove);
  }
}
