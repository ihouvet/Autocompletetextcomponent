export type ContextValue = string | number | boolean | null | undefined | ContextObject;

export interface ContextObject {
  [key: string]: ContextValue;
}

export interface ArgDef {
  name: string;
  description: string;
  optional?: boolean;
}

export interface FunctionDef {
  name: string;
  description: string;
  category: 'String' | 'Date' | 'Number' | 'Logic';
  args: ArgDef[];
  evaluate: (...args: unknown[]) => unknown;
}

export interface Suggestion {
  label: string;
  insertText: string;
  description: string;
  category: string;
  type: 'function' | 'object' | 'property';
}

// AST Node types
export type ASTNode =
  | { type: 'literal'; value: string | number | boolean | null }
  | { type: 'variable'; path: string[] }
  | { type: 'functionCall'; name: string; args: ASTNode[] }
  | { type: 'binaryOp'; op: string; left: ASTNode; right: ASTNode }
  | { type: 'unaryOp'; op: string; operand: ASTNode };
