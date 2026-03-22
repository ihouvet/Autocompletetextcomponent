import { useState, useRef, useCallback, useEffect } from 'react';
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

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const showDropdown = suggestions.length > 0 && dropdownPos !== null;

  const updateSuggestions = useCallback(
    (text: string, cursorPos: number) => {
      const results = getSuggestions(text, cursorPos, context, functions);
      setSuggestions(results);
      setActiveIndex(0);

      if (results.length > 0) {
        calculateDropdownPosition(text, cursorPos);
      } else {
        setDropdownPos(null);
      }
    },
    [context, functions]
  );

  const calculateDropdownPosition = useCallback((text: string, cursorPos: number) => {
    const textarea = textareaRef.current;
    const mirror = mirrorRef.current;
    if (!textarea || !mirror) return;

    // Set mirror to same width as textarea
    mirror.style.width = `${textarea.clientWidth}px`;

    // Put text up to cursor into mirror, append a marker span
    const textBefore = text.slice(0, cursorPos);
    mirror.textContent = '';

    const textNode = document.createTextNode(textBefore);
    const marker = document.createElement('span');
    marker.textContent = '|';
    mirror.appendChild(textNode);
    mirror.appendChild(marker);

    const markerRect = marker.getBoundingClientRect();
    const textareaRect = textarea.getBoundingClientRect();

    const top = markerRect.top - textareaRect.top + textarea.offsetTop + 24;
    const left = markerRect.left - textareaRect.left + textarea.offsetLeft;

    setDropdownPos({ top, left: Math.min(left, textarea.clientWidth - 100) });
  }, []);

  const insertSuggestion = useCallback(
    (suggestion: Suggestion) => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      const cursorPos = textarea.selectionStart;
      const mustacheCtx = getMustacheContext(value, cursorPos);
      if (!mustacheCtx) return;

      const { partial } = mustacheCtx;
      const { token, prefixPath } = extractToken(partial);

      // Calculate how much text to replace
      // We need to replace the current token with the suggestion's insertText
      let replaceStart: number;
      let replaceEnd = cursorPos;

      if (prefixPath.length > 0) {
        // Replace just the token part after the last dot
        replaceStart = cursorPos - token.length;
      } else {
        // Replace the whole token from the start of the partial
        // Find where the current relevant part starts
        const beforeCursor = value.slice(mustacheCtx.startPos, cursorPos);
        // Find the last ( or , to determine where our token starts
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
        // Skip any whitespace after the boundary
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

      // Restore focus and cursor position
      requestAnimationFrame(() => {
        textarea.focus();
        textarea.setSelectionRange(newCursorPos, newCursorPos);

        // Re-trigger suggestions if we just inserted something that ends with ( or .
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
      const cursorPos = e.target.selectionStart;
      onChange(newValue);
      updateSuggestions(newValue, cursorPos);
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

  const handleClick = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    updateSuggestions(value, textarea.selectionStart);
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
      <textarea
        ref={textareaRef}
        className="autocomplete-textarea"
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onClick={handleClick}
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
