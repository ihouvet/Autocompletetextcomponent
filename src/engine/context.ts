import type { ContextObject, ContextValue } from './types';

export const testContext: ContextObject = {
  Myobject1: {
    dyntext11: 'dyntext11',
    dyntext12: 'dyntext12',
  },
  Myobject2: {
    child2: {
      myVar1: 12,
    },
  },
};

export function resolveContextPath(context: ContextObject, path: string[]): ContextValue {
  let current: ContextValue = context;
  for (const key of path) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as ContextObject)[key];
  }
  return current;
}

export function getContextKeys(context: ContextObject, path: string[] = []): string[] {
  let current: ContextValue = context;
  for (const key of path) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return [];
    }
    current = (current as ContextObject)[key];
  }
  if (current === null || current === undefined || typeof current !== 'object') {
    return [];
  }
  return Object.keys(current as ContextObject);
}
