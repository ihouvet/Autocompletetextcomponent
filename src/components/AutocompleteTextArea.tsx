import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import type { ContextObject, FunctionDef, Suggestion } from '../engine/types';
import { getSuggestions, getMustacheContext, extractToken } from '../engine/autocomplete';
import './AutocompleteTextArea.css';

interface AutocompleteTextAreaProps {
  value: string;
  onChange: (value: string) => void;
  context: ContextObject;
  functions: Map<string, FunctionDef>;
  placeholder?: string;
  rows?: number;
}

// ── Syntax Highlighting ─────────────────────────────────────────────

interface HighlightToken {
  text: string;
  className: string;
}

/**
 * Find the matching bracket/paren for the one at `pos` in `text`.
 * Returns the index of the matching bracket, or -1.
 */
function findMatchingBracket(text: string, pos: number): number {
  const ch = text[pos];
  const pairs: Record<string, { match: string; dir: 1 | -1 }> = {
    '(': { match: ')', dir: 1 },
    ')': { match: '(', dir: -1 },
  };
  const pair = pairs[ch];
  if (!pair) return -1;

  let depth = 0;
  let i = pos;
  while (i >= 0 && i < text.length) {
    if (text[i] === ch) depth++;
    else if (text[i] === pair.match) depth--;
    if (depth === 0) return i;
    i += pair.dir;
  }
  return -1;
}

/**
 * Tokenize text inside a mustache expression for syntax coloring.
 * Identifies functions (uppercase identifiers followed by `(`), variables/objects,
 * string literals, numbers, operators, parentheses, and commas.
 */
function tokenizeExpression(expr: string, knownFunctions: Set<string>): HighlightToken[] {
  const tokens: HighlightToken[] = [];
  let i = 0;

  while (i < expr.length) {
    const ch = expr[i];

    // Whitespace
    if (/\s/.test(ch)) {
      let j = i;
      while (j < expr.length && /\s/.test(expr[j])) j++;
      tokens.push({ text: expr.slice(i, j), className: '' });
      i = j;
      continue;
    }

    // String literal
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < expr.length && expr[j] !== ch) {
        if (expr[j] === '\\') j++;
        j++;
      }
      if (j < expr.length) j++; // include closing quote
      tokens.push({ text: expr.slice(i, j), className: 'hl-string' });
      i = j;
      continue;
    }

    // Number
    if (/\d/.test(ch) || (ch === '-' && i + 1 < expr.length && /\d/.test(expr[i + 1]))) {
      let j = i;
      if (expr[j] === '-') j++;
      while (j < expr.length && /[\d.]/.test(expr[j])) j++;
      tokens.push({ text: expr.slice(i, j), className: 'hl-number' });
      i = j;
      continue;
    }

    // Identifier (function or variable)
    if (/[a-zA-Z_]/.test(ch)) {
      let j = i;
      while (j < expr.length && /[a-zA-Z0-9_]/.test(expr[j])) j++;
      const word = expr.slice(i, j);

      // Check for booleans/null
      if (word === 'true' || word === 'false' || word === 'null') {
        tokens.push({ text: word, className: 'hl-keyword' });
        i = j;
        continue;
      }

      // Look ahead for `(` to detect function call
      let k = j;
      while (k < expr.length && /\s/.test(expr[k])) k++;
      if (k < expr.length && expr[k] === '(' && knownFunctions.has(word.toUpperCase())) {
        tokens.push({ text: word, className: 'hl-function' });
      } else {
        // It's a variable/object reference
        tokens.push({ text: word, className: 'hl-variable' });
      }
      i = j;
      continue;
    }

    // Dot (property accessor)
    if (ch === '.') {
      tokens.push({ text: '.', className: 'hl-dot' });
      i++;
      continue;
    }

    // Parentheses
    if (ch === '(' || ch === ')') {
      tokens.push({ text: ch, className: 'hl-paren' });
      i++;
      continue;
    }

    // Comma
    if (ch === ',') {
      tokens.push({ text: ',', className: 'hl-comma' });
      i++;
      continue;
    }

    // Operators
    if ('+-*/><=!'.includes(ch)) {
      let j = i + 1;
      if (j < expr.length && '='.includes(expr[j])) j++;
      tokens.push({ text: expr.slice(i, j), className: 'hl-operator' });
      i = j;
      continue;
    }

    // Anything else
    tokens.push({ text: ch, className: '' });
    i++;
  }

  return tokens;
}

/**
 * Parse the full text into highlighted segments.
 * Plain text is unstyled, mustache blocks get syntax-colored.
 */
function highlightText(
  text: string,
  knownFunctions: Set<string>,
  cursorPos: number | null
): HighlightToken[] {
  const result: HighlightToken[] = [];

  let lastIndex = 0;

  // Collect complete and incomplete mustache blocks
  interface Block { start: number; end: number; inner: string; closed: boolean }
  const blocks: Block[] = [];

  // First pass: find complete {{...}}
  const completeRegex = /\{\{(.*?)\}\}/gs;
  let m: RegExpExecArray | null;
  while ((m = completeRegex.exec(text)) !== null) {
    blocks.push({
      start: m.index,
      end: m.index + m[0].length,
      inner: m[1],
      closed: true,
    });
  }

  // Second pass: find unclosed {{ (only if cursor is in it)
  // Find the last {{ that is not part of a closed block
  let openIdx = text.lastIndexOf('{{');
  if (openIdx >= 0) {
    const isInClosedBlock = blocks.some(b => openIdx >= b.start && openIdx < b.end);
    if (!isInClosedBlock) {
      blocks.push({
        start: openIdx,
        end: text.length,
        inner: text.slice(openIdx + 2),
        closed: false,
      });
    }
  }

  blocks.sort((a, b) => a.start - b.start);

  // Determine which bracket pairs to highlight based on cursor position
  let matchedBracketPairs: Array<[number, number]> = [];
  if (cursorPos !== null) {
    // Find which block the cursor is in
    for (const block of blocks) {
      if (cursorPos > block.start && cursorPos <= block.end) {
        const exprStart = block.start + 2; // after {{
        const relCursor = cursorPos - exprStart;
        const inner = block.inner;

        // Check character just before cursor and at cursor
        for (const checkPos of [relCursor - 1, relCursor]) {
          if (checkPos >= 0 && checkPos < inner.length) {
            const ch = inner[checkPos];
            if (ch === '(' || ch === ')') {
              const matchPos = findMatchingBracket(inner, checkPos);
              if (matchPos >= 0) {
                matchedBracketPairs.push([
                  exprStart + checkPos,
                  exprStart + matchPos,
                ]);
              }
            }
          }
        }
        break;
      }
    }
  }

  // Now build highlight tokens
  lastIndex = 0;
  for (const block of blocks) {
    // Plain text before block
    if (block.start > lastIndex) {
      result.push({ text: text.slice(lastIndex, block.start), className: '' });
    }

    // Opening brackets
    result.push({ text: '{{', className: 'hl-bracket' });

    // Tokenize expression content
    const exprStart = block.start + 2;
    const exprTokens = tokenizeExpression(block.inner, knownFunctions);

    // Render tokens, applying bracket match highlights
    let offset = exprStart;
    for (const tok of exprTokens) {
      const tokStart = offset;
      const tokEnd = offset + tok.text.length;

      // Check if this token (a paren) is part of a matched pair
      if ((tok.className === 'hl-paren') && tok.text.length === 1) {
        const isMatched = matchedBracketPairs.some(
          ([a, b]) => tokStart === a || tokStart === b
        );
        if (isMatched) {
          result.push({ text: tok.text, className: 'hl-paren-matched' });
          offset = tokEnd;
          continue;
        }
      }

      result.push(tok);
      offset = tokEnd;
    }

    // Closing brackets (if the block is closed)
    if (block.closed) {
      result.push({ text: '}}', className: 'hl-bracket' });
    }

    lastIndex = block.end;
  }

  // Remaining plain text
  if (lastIndex < text.length) {
    result.push({ text: text.slice(lastIndex), className: '' });
  }

  return result;
}

// ── Component ───────────────────────────────────────────────────────

export function AutocompleteTextArea({
  value,
  onChange,
  context,
  functions,
  placeholder,
  rows = 8,
}: AutocompleteTextAreaProps) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number } | null>(null);
  const [cursorPos, setCursorPos] = useState<number | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  const showDropdown = suggestions.length > 0 && dropdownPos !== null;

  // Build set of known function names for highlighting
  const knownFunctionNames = useMemo(() => {
    const names = new Set<string>();
    for (const [name] of functions) {
      names.add(name.toUpperCase());
    }
    return names;
  }, [functions]);

  // Generate highlighted tokens
  const highlightTokens = useMemo(
    () => highlightText(value, knownFunctionNames, cursorPos),
    [value, knownFunctionNames, cursorPos]
  );

  // Sync backdrop scroll with textarea scroll
  const handleScroll = useCallback(() => {
    if (textareaRef.current && backdropRef.current) {
      backdropRef.current.scrollTop = textareaRef.current.scrollTop;
      backdropRef.current.scrollLeft = textareaRef.current.scrollLeft;
    }
  }, []);

  const updateSuggestions = useCallback(
    (text: string, cp: number) => {
      const results = getSuggestions(text, cp, context, functions);
      setSuggestions(results);
      setActiveIndex(0);

      if (results.length > 0) {
        calculateDropdownPosition(text, cp);
      } else {
        setDropdownPos(null);
      }
    },
    [context, functions]
  );

  const calculateDropdownPosition = useCallback((text: string, cp: number) => {
    const textarea = textareaRef.current;
    const mirror = mirrorRef.current;
    if (!textarea || !mirror) return;

    mirror.style.width = `${textarea.clientWidth}px`;

    const textBefore = text.slice(0, cp);
    mirror.textContent = '';

    const textNode = document.createTextNode(textBefore);
    const marker = document.createElement('span');
    marker.textContent = '|';
    mirror.appendChild(textNode);
    mirror.appendChild(marker);

    const markerRect = marker.getBoundingClientRect();
    const textareaRect = textarea.getBoundingClientRect();

    const top = markerRect.top - textareaRect.top + textarea.offsetTop + 24 - textarea.scrollTop;
    const left = markerRect.left - textareaRect.left + textarea.offsetLeft;

    setDropdownPos({ top, left: Math.min(left, textarea.clientWidth - 100) });
  }, []);

  const insertSuggestion = useCallback(
    (suggestion: Suggestion) => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      const cp = textarea.selectionStart;
      const mustacheCtx = getMustacheContext(value, cp);
      if (!mustacheCtx) return;

      const { partial } = mustacheCtx;
      const { token, prefixPath } = extractToken(partial);

      let replaceStart: number;
      const replaceEnd = cp;

      if (prefixPath.length > 0) {
        replaceStart = cp - token.length;
      } else {
        const beforeCursor = value.slice(mustacheCtx.startPos, cp);
        let tokenStartInPartial = 0;
        let inString = false;
        let stringChar = '';
        for (let i = 0; i < beforeCursor.length; i++) {
          const ch = beforeCursor[i];
          if (inString) {
            if (ch === stringChar && beforeCursor[i - 1] !== '\\') inString = false;
            continue;
          }
          if (ch === '"' || ch === "'") {
            inString = true;
            stringChar = ch;
            continue;
          }
          if (ch === '(' || ch === ',') {
            tokenStartInPartial = i + 1;
          }
        }
        while (
          tokenStartInPartial < beforeCursor.length &&
          beforeCursor[tokenStartInPartial] === ' '
        ) {
          tokenStartInPartial++;
        }
        replaceStart = mustacheCtx.startPos + tokenStartInPartial;
      }

      const newValue =
        value.slice(0, replaceStart) + suggestion.insertText + value.slice(replaceEnd);
      const newCursorPos = replaceStart + suggestion.insertText.length;

      onChange(newValue);
      setSuggestions([]);
      setDropdownPos(null);

      requestAnimationFrame(() => {
        textarea.focus();
        textarea.setSelectionRange(newCursorPos, newCursorPos);
        setCursorPos(newCursorPos);

        if (suggestion.insertText.endsWith('(') || suggestion.insertText.endsWith('.')) {
          updateSuggestions(newValue, newCursorPos);
        }
      });
    },
    [value, onChange, updateSuggestions]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = e.target.value;
      const cp = e.target.selectionStart;
      onChange(newValue);
      setCursorPos(cp);
      updateSuggestions(newValue, cp);
    },
    [onChange, updateSuggestions]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (!showDropdown) return;

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setActiveIndex((prev) => (prev + 1) % suggestions.length);
          break;
        case 'ArrowUp':
          e.preventDefault();
          setActiveIndex((prev) => (prev - 1 + suggestions.length) % suggestions.length);
          break;
        case 'Tab':
        case 'Enter':
          e.preventDefault();
          insertSuggestion(suggestions[activeIndex]);
          break;
        case 'Escape':
          e.preventDefault();
          setSuggestions([]);
          setDropdownPos(null);
          break;
      }
    },
    [showDropdown, suggestions, activeIndex, insertSuggestion]
  );

  const handleSelect = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const cp = textarea.selectionStart;
    setCursorPos(cp);
    updateSuggestions(value, cp);
  }, [value, updateSuggestions]);

  // Scroll active item into view
  useEffect(() => {
    if (!showDropdown || !dropdownRef.current) return;
    const activeEl = dropdownRef.current.querySelector('.autocomplete-dropdown-item.active');
    if (activeEl) {
      activeEl.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex, showDropdown]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        textareaRef.current !== e.target
      ) {
        setSuggestions([]);
        setDropdownPos(null);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  return (
    <div className="autocomplete-textarea-wrapper">
      {/* Highlighted backdrop (behind transparent textarea) */}
      <div
        ref={backdropRef}
        className="autocomplete-backdrop"
        aria-hidden="true"
      >
        <div className="autocomplete-backdrop-content">
          {highlightTokens.map((tok, i) => {
            if (!tok.className) {
              return <span key={i}>{tok.text}</span>;
            }
            return (
              <span key={i} className={tok.className}>
                {tok.text}
              </span>
            );
          })}
          {/* Trailing newline to match textarea height */}
          {value.endsWith('\n') && <span>{'\n'}</span>}
        </div>
      </div>

      {/* Transparent textarea on top for actual editing */}
      <textarea
        ref={textareaRef}
        className="autocomplete-textarea"
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onSelect={handleSelect}
        onScroll={handleScroll}
        placeholder={placeholder}
        rows={rows}
        spellCheck={false}
      />

      {/* Hidden mirror to compute cursor pixel position */}
      <div ref={mirrorRef} className="autocomplete-mirror" aria-hidden="true" />

      {showDropdown && dropdownPos && (
        <div
          ref={dropdownRef}
          className="autocomplete-dropdown"
          style={{ top: dropdownPos.top, left: dropdownPos.left }}
        >
          {suggestions.map((s, i) => (
            <div
              key={`${s.label}-${i}`}
              className={`autocomplete-dropdown-item ${i === activeIndex ? 'active' : ''}`}
              onMouseDown={(e) => {
                e.preventDefault();
                insertSuggestion(s);
              }}
              onMouseEnter={() => setActiveIndex(i)}
            >
              <span className={`item-badge ${s.category}`}>{s.category}</span>
              <div className="item-content">
                <div className="item-label">{s.label}</div>
                <div className="item-description">{s.description}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
