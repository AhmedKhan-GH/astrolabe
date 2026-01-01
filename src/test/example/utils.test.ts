import { describe, it, expect, beforeEach } from 'vitest';

// Example utility functions to test
function add(a: number, b: number): number {
  return a + b;
}

function formatUserName(firstName: string, lastName: string): string {
  return `${firstName} ${lastName}`.trim();
}

class DataStore {
  private data: Map<string, any> = new Map();

  set(key: string, value: any): void {
    this.data.set(key, value);
  }

  get(key: string): any {
    return this.data.get(key);
  }

  clear(): void {
    this.data.clear();
  }
}

describe('Utility Functions', () => {
  describe('add', () => {
    it('adds two positive numbers', () => {
      expect(add(2, 3)).toBe(5);
    });

    it('adds negative numbers', () => {
      expect(add(-2, -3)).toBe(-5);
    });

    it('adds positive and negative numbers', () => {
      expect(add(5, -3)).toBe(2);
    });
  });

  describe('formatUserName', () => {
    it('formats full name correctly', () => {
      expect(formatUserName('John', 'Doe')).toBe('John Doe');
    });

    it('handles empty last name', () => {
      expect(formatUserName('John', '')).toBe('John');
    });

    it('handles empty first name', () => {
      expect(formatUserName('', 'Doe')).toBe('Doe');
    });
  });
});

describe('DataStore', () => {
  let store: DataStore;

  beforeEach(() => {
    store = new DataStore();
  });

  it('stores and retrieves data', () => {
    store.set('user', { name: 'John' });
    expect(store.get('user')).toEqual({ name: 'John' });
  });

  it('returns undefined for non-existent keys', () => {
    expect(store.get('nonexistent')).toBeUndefined();
  });

  it('clears all data', () => {
    store.set('key1', 'value1');
    store.set('key2', 'value2');
    store.clear();
    expect(store.get('key1')).toBeUndefined();
    expect(store.get('key2')).toBeUndefined();
  });
});
