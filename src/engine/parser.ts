import type { ASTNode } from './types';

/**
 * Recursive descent parser for mustache expressions.
 * Supports: literals, variables (dot paths), function calls,
 * comparison operators, arithmetic, and string concatenation.
 */

class Parser {
  private pos = 0;
  private input: string;

  constructor(input: string) {
    this.input = input.trim();
  }

  parse(): ASTNode {
    const node = this.parseExpression();
    this.skipWhitespace();
    if (this.pos < this.input.length) {
      throw new Error(`Unexpected character '${this.input[this.pos]}' at position ${this.pos}`);
    }
    return node;
  }

  private parseExpression(): ASTNode {
    return this.parseComparison();
  }

  private parseComparison(): ASTNode {
    let left = this.parseAddSub();
    this.skipWhitespace();

    const ops = ['>=', '<=', '!=', '==', '>', '<'];
    for (const op of ops) {
      if (this.input.startsWith(op, this.pos)) {
        this.pos += op.length;
        const right = this.parseAddSub();
        left = { type: 'binaryOp', op, left, right };
        this.skipWhitespace();
      }
    }
    return left;
  }

  private parseAddSub(): ASTNode {
    let left = this.parseMulDiv();
    this.skipWhitespace();

    while (this.pos < this.input.length) {
      const ch = this.input[this.pos];
      if (ch === '+' || ch === '-') {
        this.pos++;
        const right = this.parseMulDiv();
        left = { type: 'binaryOp', op: ch, left, right };
        this.skipWhitespace();
      } else {
        break;
      }
    }
    return left;
  }

  private parseMulDiv(): ASTNode {
    let left = this.parseUnary();
    this.skipWhitespace();

    while (this.pos < this.input.length) {
      const ch = this.input[this.pos];
      if (ch === '*' || ch === '/') {
        this.pos++;
        const right = this.parseUnary();
        left = { type: 'binaryOp', op: ch, left, right };
        this.skipWhitespace();
      } else {
        break;
      }
    }
    return left;
  }

  private parseUnary(): ASTNode {
    this.skipWhitespace();
    if (this.pos < this.input.length && this.input[this.pos] === '-') {
      // Check it's not a negative number literal
      if (this.pos + 1 < this.input.length && /\d/.test(this.input[this.pos + 1])) {
        return this.parsePrimary();
      }
      this.pos++;
      const operand = this.parsePrimary();
      return { type: 'unaryOp', op: '-', operand };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): ASTNode {
    this.skipWhitespace();

    if (this.pos >= this.input.length) {
      throw new Error('Unexpected end of expression');
    }

    const ch = this.input[this.pos];

    // Parenthesized expression
    if (ch === '(') {
      this.pos++;
      const node = this.parseExpression();
      this.skipWhitespace();
      if (this.pos >= this.input.length || this.input[this.pos] !== ')') {
        throw new Error('Expected closing parenthesis');
      }
      this.pos++;
      return node;
    }

    // String literal (double quotes)
    if (ch === '"') {
      return this.parseStringLiteral('"');
    }

    // String literal (single quotes)
    if (ch === "'") {
      return this.parseStringLiteral("'");
    }

    // Number literal (including negative)
    if (ch === '-' || /\d/.test(ch)) {
      return this.parseNumberLiteral();
    }

    // Boolean or null literal, or identifier (variable/function)
    if (/[a-zA-Z_]/.test(ch)) {
      return this.parseIdentifierOrCall();
    }

    throw new Error(`Unexpected character '${ch}' at position ${this.pos}`);
  }

  private parseStringLiteral(quote: string): ASTNode {
    this.pos++; // skip opening quote
    let value = '';
    while (this.pos < this.input.length && this.input[this.pos] !== quote) {
      if (this.input[this.pos] === '\\' && this.pos + 1 < this.input.length) {
        this.pos++;
        const escaped = this.input[this.pos];
        if (escaped === 'n') value += '\n';
        else if (escaped === 't') value += '\t';
        else value += escaped;
      } else {
        value += this.input[this.pos];
      }
      this.pos++;
    }
    if (this.pos >= this.input.length) {
      throw new Error(`Unterminated string literal`);
    }
    this.pos++; // skip closing quote
    return { type: 'literal', value };
  }

  private parseNumberLiteral(): ASTNode {
    const start = this.pos;
    if (this.input[this.pos] === '-') this.pos++;
    while (this.pos < this.input.length && /\d/.test(this.input[this.pos])) {
      this.pos++;
    }
    if (this.pos < this.input.length && this.input[this.pos] === '.') {
      this.pos++;
      while (this.pos < this.input.length && /\d/.test(this.input[this.pos])) {
        this.pos++;
      }
    }
    const numStr = this.input.slice(start, this.pos);
    return { type: 'literal', value: Number(numStr) };
  }

  private parseIdentifierOrCall(): ASTNode {
    const name = this.readIdentifier();

    // Check for boolean/null literals
    if (name === 'true') return { type: 'literal', value: true };
    if (name === 'false') return { type: 'literal', value: false };
    if (name === 'null') return { type: 'literal', value: null };

    this.skipWhitespace();

    // Check if it's a function call
    if (this.pos < this.input.length && this.input[this.pos] === '(') {
      this.pos++; // skip '('
      const args: ASTNode[] = [];
      this.skipWhitespace();

      if (this.pos < this.input.length && this.input[this.pos] !== ')') {
        args.push(this.parseExpression());
        this.skipWhitespace();

        while (this.pos < this.input.length && this.input[this.pos] === ',') {
          this.pos++; // skip ','
          args.push(this.parseExpression());
          this.skipWhitespace();
        }
      }

      if (this.pos >= this.input.length || this.input[this.pos] !== ')') {
        throw new Error(`Expected ')' after function arguments for ${name}()`);
      }
      this.pos++; // skip ')'

      return { type: 'functionCall', name, args };
    }

    // It's a variable — possibly with dot notation
    const path = [name];
    while (this.pos < this.input.length && this.input[this.pos] === '.') {
      this.pos++; // skip '.'
      const next = this.readIdentifier();
      if (!next) {
        throw new Error(`Expected property name after '.'`);
      }
      path.push(next);
    }

    return { type: 'variable', path };
  }

  private readIdentifier(): string {
    const start = this.pos;
    while (this.pos < this.input.length && /[a-zA-Z0-9_]/.test(this.input[this.pos])) {
      this.pos++;
    }
    if (this.pos === start) {
      throw new Error(`Expected identifier at position ${this.pos}`);
    }
    return this.input.slice(start, this.pos);
  }

  private skipWhitespace() {
    while (this.pos < this.input.length && /\s/.test(this.input[this.pos])) {
      this.pos++;
    }
  }
}

export function parseExpression(input: string): ASTNode {
  return new Parser(input).parse();
}

export interface MustacheMatch {
  start: number;
  end: number;
  expression: string;
  raw: string;
}

export function findMustacheExpressions(text: string): MustacheMatch[] {
  const matches: MustacheMatch[] = [];
  const regex = /\{\{(.*?)\}\}/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    matches.push({
      start: match.index,
      end: match.index + match[0].length,
      expression: match[1].trim(),
      raw: match[0],
    });
  }
  return matches;
}
