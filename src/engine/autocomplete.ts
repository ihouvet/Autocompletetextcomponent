import type { ContextObject, FunctionDef, Suggestion } from './types';
import { getContextKeys } from './context';

/**
 * Determines if the cursor is currently inside a {{ }} expression,
 * and returns the partial text being typed. Returns null if not inside
 * a mustache expression.
 */
export function getMustacheContext(
  text: string,
  cursorPos: number
): { insideMustache: boolean; partial: string; startPos: number } | null {
  // Look backward from cursor to find the nearest {{ that isn't closed
  const before = text.slice(0, cursorPos);

  let lastOpen = -1;
  let searchFrom = 0;
  while (true) {
    const idx = before.indexOf('{{', searchFrom);
    if (idx === -1) break;
    lastOpen = idx;
    searchFrom = idx + 2;
  }

  if (lastOpen === -1) return null;

  // Check if there's a closing }} between lastOpen and cursor
  const betweenOpenAndCursor = before.slice(lastOpen + 2);
  if (betweenOpenAndCursor.includes('}}')) return null;

  const partial = betweenOpenAndCursor.trim();
  return { insideMustache: true, partial, startPos: lastOpen + 2 };
}

/**
 * Extracts the current token being typed for autocomplete purposes.
 * Handles cases like:
 *   "UPPER(Myobj" -> token = "Myobj", context is function argument
 *   "Myobject1." -> token = "", prefix path = ["Myobject1"]
 *   "Myobject1.dyn" -> token = "dyn", prefix path = ["Myobject1"]
 *   "UP" -> token = "UP", no prefix
 */
export function extractToken(partial: string): {
  token: string;
  prefixPath: string[];
  inFunctionArg: boolean;
} {
  // Find the last token boundary: after '(' or ','
  let relevantPart = partial;
  let inFunctionArg = false;

  // Walk back to find the last ( or , that isn't inside quotes
  let lastBoundary = -1;
  let inString = false;
  let stringChar = '';
  let parenDepth = 0;

  for (let i = 0; i < partial.length; i++) {
    const ch = partial[i];
    if (inString) {
      if (ch === stringChar && partial[i - 1] !== '\\') inString = false;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      stringChar = ch;
      continue;
    }
    if (ch === '(') {
      parenDepth++;
      lastBoundary = i;
      inFunctionArg = true;
    } else if (ch === ')') {
      parenDepth--;
    } else if (ch === ',' && parenDepth > 0) {
      lastBoundary = i;
    }
  }

  if (lastBoundary >= 0) {
    relevantPart = partial.slice(lastBoundary + 1).trim();
  }

  // Now parse the relevant part for dot-path
  // e.g. "Myobject1.child." -> prefixPath=["Myobject1","child"], token=""
  // e.g. "Myobject1.dyn" -> prefixPath=["Myobject1"], token="dyn"
  // e.g. "UP" -> prefixPath=[], token="UP"

  const parts = relevantPart.split('.');

  if (relevantPart.endsWith('.')) {
    // User just typed a dot, they want children
    return {
      token: '',
      prefixPath: parts.slice(0, -1), // all parts except the trailing empty one
      inFunctionArg,
    };
  }

  if (parts.length > 1) {
    return {
      token: parts[parts.length - 1],
      prefixPath: parts.slice(0, -1),
      inFunctionArg,
    };
  }

  return {
    token: parts[0],
    prefixPath: [],
    inFunctionArg,
  };
}

export function getSuggestions(
  text: string,
  cursorPos: number,
  context: ContextObject,
  functions: Map<string, FunctionDef>
): Suggestion[] {
  const mustacheCtx = getMustacheContext(text, cursorPos);
  if (!mustacheCtx) return [];

  const { partial } = mustacheCtx;
  const { token, prefixPath, inFunctionArg } = extractToken(partial);
  const lowerToken = token.toLowerCase();

  const suggestions: Suggestion[] = [];

  // If we have a prefix path, suggest children of that path
  if (prefixPath.length > 0) {
    const keys = getContextKeys(context, prefixPath);
    const pathStr = prefixPath.join('.');
    for (const key of keys) {
      if (lowerToken === '' || key.toLowerCase().startsWith(lowerToken)) {
        suggestions.push({
          label: key,
          insertText: key,
          description: `Property of ${pathStr}`,
          category: 'Object',
          type: 'property',
        });
      }
    }
    return suggestions;
  }

  // Suggest top-level context objects
  const topKeys = getContextKeys(context);
  for (const key of topKeys) {
    if (lowerToken === '' || key.toLowerCase().startsWith(lowerToken)) {
      suggestions.push({
        label: key,
        insertText: key,
        description: `Data object`,
        category: 'Object',
        type: 'object',
      });
    }
  }

  // Suggest functions (unless we're already deep in a dot path)
  if (!inFunctionArg || lowerToken !== '') {
    for (const [, fn] of functions) {
      if (lowerToken === '' || fn.name.toLowerCase().startsWith(lowerToken)) {
        const argStr = fn.args
          .filter(a => a.name !== '...more')
          .map((a) => a.name)
          .join(', ');
        suggestions.push({
          label: `${fn.name}(${argStr})`,
          insertText: `${fn.name}(`,
          description: fn.description,
          category: fn.category,
          type: 'function',
        });
      }
    }
  }

  // Sort: objects first, then functions; alphabetically within each group
  suggestions.sort((a, b) => {
    if (a.type !== b.type) {
      const order = { object: 0, property: 1, function: 2 };
      return order[a.type] - order[b.type];
    }
    return a.label.localeCompare(b.label);
  });

  return suggestions;
}
