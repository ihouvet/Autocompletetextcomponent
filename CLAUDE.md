# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- **Dev server:** `npm run dev` (Vite with HMR)
- **Build:** `npm run build` (runs `tsc -b && vite build`)
- **Lint:** `npm run lint` (ESLint)
- **Preview production build:** `npm run preview`

No test framework is currently configured.

## Architecture

This is a React + TypeScript + Vite app that implements a **mustache expression textarea** — a text input that mixes free text with `{{expression}}` blocks, providing autocomplete and live evaluation.

### Expression Engine (`src/engine/`)

A self-contained expression language evaluated at runtime, independent of React:

- **`types.ts`** — Core types: `ASTNode` (5 node kinds: literal, variable, functionCall, binaryOp, unaryOp), `FunctionDef`, `Suggestion`, `ContextObject`
- **`parser.ts`** — Recursive descent parser that converts expression strings into AST nodes. Also exports `findMustacheExpressions()` to locate all `{{...}}` spans in a template string.
- **`evaluator.ts`** — Walks the AST against a context object and function registry. `evaluateTemplate()` is the top-level entry point: replaces all mustache expressions in a string with their evaluated results and collects errors.
- **`functions.ts`** — Registry of built-in functions (`functionRegistry: Map<string, FunctionDef>`) across four categories: String, Date, Number, Logic. Function names are UPPER_CASE (e.g., `UPPER`, `IF`, `DATEADD`).
- **`autocomplete.ts`** — Cursor-aware suggestion logic. `getMustacheContext()` detects if the cursor is inside `{{ }}`. `extractToken()` parses the partial input to determine dot-path prefix and whether we're inside a function argument. `getSuggestions()` returns filtered/sorted suggestions.
- **`context.ts`** — Resolves dot-path variable lookups (`resolveContextPath`) and lists available keys at a path (`getContextKeys`). Contains `testContext` with sample data objects.

### UI (`src/components/`)

- **`AutocompleteTextArea.tsx`** — Controlled textarea component that shows a positioned dropdown of suggestions when typing inside `{{ }}`. Uses a hidden mirror div to calculate cursor pixel position for dropdown placement. Accepts `context` and `functions` props to drive suggestions.

### Data Flow

`App.tsx` wires everything together: the `AutocompleteTextArea` takes `testContext` and `functionRegistry` as props. On every text change, `evaluateTemplate()` runs to produce a live preview with error reporting.
