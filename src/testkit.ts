import assert from "node:assert/strict";
import { mock } from "node:test";

export { describe, it, beforeEach, afterEach } from "node:test";

type MockFn = ((...args: any[]) => any) & {
  mock: { calls: any[][] };
  mockClear: () => MockFn;
  mockResolvedValue: (value: any) => MockFn;
  mockResolvedValueOnce: (value: any) => MockFn;
  mockRejectedValueOnce: (error: any) => MockFn;
  mockImplementation: (implementation: (...args: any[]) => any) => MockFn;
  mockImplementationOnce: (implementation: (...args: any[]) => any) => MockFn;
};

const trackedFns: MockFn[] = [];
const globalStubs = new Map<string, unknown>();

function deepEqual(a: unknown, b: unknown): boolean {
  if (isObjectContaining(b)) return matchesPartial(a, b[OBJECT_CONTAINING]);
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => deepEqual(item, b[index]));
  }
  if (
    typeof a === "object" && a !== null &&
    typeof b === "object" && b !== null &&
    !(a instanceof Date) && !(b instanceof Date)
  ) {
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    const aKeys = Object.keys(aObj);
    const bKeys = Object.keys(bObj);
    return (
      aKeys.length === bKeys.length &&
      bKeys.every((key) => key in aObj && deepEqual(aObj[key], bObj[key]))
    );
  }
  try {
    assert.deepStrictEqual(a, b);
    return true;
  } catch {
    return false;
  }
}

const OBJECT_CONTAINING = Symbol("objectContaining");

export function objectContaining(expected: Record<string, unknown>) {
  return { [OBJECT_CONTAINING]: expected };
}

function isObjectContaining(value: unknown): value is { [OBJECT_CONTAINING]: Record<string, unknown> } {
  return typeof value === "object" && value !== null && OBJECT_CONTAINING in value;
}

function matchesPartial(actual: unknown, expected: Record<string, unknown>): boolean {
  if (typeof actual !== "object" || actual === null) return false;
  for (const [key, value] of Object.entries(expected)) {
    const actualValue = (actual as Record<string, unknown>)[key];
    if (isObjectContaining(value)) {
      if (!matchesPartial(actualValue, value[OBJECT_CONTAINING])) return false;
    } else if (!deepEqual(actualValue, value)) {
      return false;
    }
  }
  return true;
}

function compare(actual: unknown, expected: unknown) {
  if (isObjectContaining(expected)) {
    assert.ok(matchesPartial(actual, expected[OBJECT_CONTAINING]), "expected partial object match");
    return;
  }
  assert.deepStrictEqual(actual, expected);
}

function contains(actual: unknown, expected: unknown) {
  assert.ok(
    typeof actual === "string" && expected !== null && expected !== undefined
      ? actual.includes(String(expected))
      : Array.isArray(actual) && actual.includes(expected),
    `expected value to contain ${String(expected)}`
  );
}

function throws(actual: unknown, message?: any) {
  if (typeof actual !== "function") throw new Error("expected a function");
  assert.throws(
    actual as () => unknown,
    message ? (typeof message === "string" ? new RegExp(message) : message) : undefined
  );
}

function called(actual: unknown) {
  const calls = (actual as { mock?: { calls: unknown[][] } })?.mock?.calls ?? [];
  assert.ok(calls.length > 0, "expected mock to have been called");
}

function calledTimes(actual: unknown, times: number) {
  const calls = (actual as { mock?: { calls: unknown[][] } })?.mock?.calls ?? [];
  assert.equal(calls.length, times);
}

function calledWith(actual: unknown, args: unknown[]) {
  const calls = (actual as { mock?: { calls: unknown[][] } })?.mock?.calls ?? [];
  assert.ok(calls.some((call) => deepEqual(call, args)), "expected mock call with matching args");
}

function baseMatchers(actual: unknown, negate = false) {
  const apply = (fn: () => void) => {
    if (negate) assert.throws(fn);
    else fn();
  };

  return {
    toBe: (expected: unknown) => apply(() => assert.equal(actual, expected)),
    toEqual: (expected: unknown) => apply(() => compare(actual, expected)),
    toMatch: (expected: RegExp) => apply(() => assert.match(String(actual), expected)),
    toContain: (expected: unknown) => apply(() => contains(actual, expected)),
    toBeNull: () => apply(() => assert.equal(actual, null)),
    toBeUndefined: () => apply(() => assert.equal(actual, undefined)),
    toBeDefined: () => apply(() => assert.notEqual(actual, undefined)),
    toMatchObject: (expected: Record<string, unknown>) =>
      apply(() => assert.ok(matchesPartial(actual, expected), "expected partial object match")),
    toHaveProperty: (path: string, value?: unknown) =>
      apply(() => {
        const found = path
          .split(".")
          .reduce<unknown>((obj, key) => (obj as Record<string, unknown>)?.[key], actual);
        assert.notEqual(found, undefined);
        if (value !== undefined) assert.deepStrictEqual(found, value);
      }),
    toBeTruthy: () => apply(() => assert.ok(actual)),
    toBeFalsy: () => apply(() => assert.ok(!actual)),
    toThrow: (message?: any) => apply(() => throws(actual, message)),
    toHaveBeenCalled: () => apply(() => called(actual)),
    toHaveBeenCalledTimes: (times: number) => apply(() => calledTimes(actual, times)),
    toHaveBeenCalledWith: (...args: unknown[]) => apply(() => calledWith(actual, args)),
  };
}

export const expect = Object.assign(
  (actual: unknown) => ({
    ...baseMatchers(actual),
    not: baseMatchers(actual, true),
    resolves: {
      toBe: async (expected: unknown) => compare(await Promise.resolve(actual), expected),
      toEqual: async (expected: unknown) => compare(await Promise.resolve(actual), expected),
      toBeUndefined: async () => assert.equal(await Promise.resolve(actual), undefined),
      toBeNull: async () => assert.equal(await Promise.resolve(actual), null),
    },
    rejects: {
      toThrow: async (message?: any) => {
        await assert.rejects(
          actual as Promise<unknown>,
          message ? (typeof message === "string" ? new RegExp(message) : message) : undefined as any
        );
      },
    },
  }),
  { objectContaining }
);

function callerFile(): string {
  const stack = new Error().stack ?? "";
  const line =
    stack.split("\n").find((entry) => entry.includes("file://") && !entry.includes("testkit")) ??
    "";
  const url = line.match(/(file:\/\/[^):]+)/)?.[1] ?? "";
  return url;
}

function resolveSpecifier(specifier: string): string {
  if (!specifier.startsWith(".")) return specifier;
  const file = callerFile();
  if (!file) return specifier;
  return new URL(specifier, file).href;
}

export const vi = {
  fn(implementation?: (...args: any[]) => any): MockFn {
    let next: Array<(...args: any[]) => any> = [];
    let base = implementation ?? (() => undefined);

    const wrapped = ((...args: unknown[]) => {
      wrapped.mock.calls.push(args);
      const fn = next.shift() ?? base;
      return fn(...args);
    }) as MockFn;

    wrapped.mock = { calls: [] };
    wrapped.mockClear = () => {
      wrapped.mock.calls = [];
      next = [];
      return wrapped;
    };
    wrapped.mockResolvedValue = (value) => {
      return wrapped.mockImplementation(async () => value);
    };
    wrapped.mockResolvedValueOnce = (value) => {
      next.push(async () => value);
      return wrapped;
    };
    wrapped.mockRejectedValueOnce = (error) => {
      next.push(async () => {
        throw error;
      });
      return wrapped;
    };
    wrapped.mockImplementation = (implementation) => {
      base = implementation;
      return wrapped;
    };
    wrapped.mockImplementationOnce = (implementation) => {
      next.push(implementation);
      return wrapped;
    };

    trackedFns.push(wrapped);
    return wrapped;
  },

  mocked(fn: unknown): MockFn {
    return fn as MockFn;
  },

  async mock(specifier: string, factory: any) {
    const resolved = resolveSpecifier(specifier);
    let original: unknown = {};
    try {
      original = await import(resolved);
    } catch {
      original = {};
    }

    const exports =
      typeof factory === "function"
        ? await factory(() => original)
        : factory;

    mock.module(resolved, { exports: exports as object });
  },

  clearAllMocks() {
    for (const fn of trackedFns) fn.mockClear();
  },

  stubGlobal(name: string, value: unknown) {
    if (!globalStubs.has(name)) globalStubs.set(name, (globalThis as Record<string, unknown>)[name]);
    (globalThis as Record<string, unknown>)[name] = value;
  },

  unstubAllGlobals() {
    for (const [name, value] of globalStubs) {
      (globalThis as Record<string, unknown>)[name] = value;
    }
    globalStubs.clear();
  },
};
