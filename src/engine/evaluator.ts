import type { ASTNode, ContextObject, FunctionDef } from './types';
import { resolveContextPath } from './context';
import { parseExpression, findMustacheExpressions } from './parser';

export function evaluateAST(
  node: ASTNode,
  context: ContextObject,
  functions: Map<string, FunctionDef>
): unknown {
  switch (node.type) {
    case 'literal':
      return node.value;

    case 'variable': {
      const value = resolveContextPath(context, node.path);
      if (value === undefined) {
        throw new Error(`Unknown variable: ${node.path.join('.')}`);
      }
      return value;
    }

    case 'functionCall': {
      const fn = functions.get(node.name) ?? functions.get(node.name.toUpperCase());
      if (!fn) {
        throw new Error(`Unknown function: ${node.name}()`);
      }
      const args = node.args.map((arg) => evaluateAST(arg, context, functions));
      return fn.evaluate(...args);
    }

    case 'binaryOp': {
      const left = evaluateAST(node.left, context, functions);
      const right = evaluateAST(node.right, context, functions);
      return evaluateBinaryOp(node.op, left, right);
    }

    case 'unaryOp': {
      const operand = evaluateAST(node.operand, context, functions);
      if (node.op === '-') return -(operand as number);
      throw new Error(`Unknown unary operator: ${node.op}`);
    }
  }
}

function evaluateBinaryOp(op: string, left: unknown, right: unknown): unknown {
  switch (op) {
    case '+': {
      if (typeof left === 'string' || typeof right === 'string') {
        return String(left) + String(right);
      }
      return (left as number) + (right as number);
    }
    case '-': return (left as number) - (right as number);
    case '*': return (left as number) * (right as number);
    case '/': {
      if ((right as number) === 0) throw new Error('Division by zero');
      return (left as number) / (right as number);
    }
    case '>': return (left as number) > (right as number);
    case '<': return (left as number) < (right as number);
    case '>=': return (left as number) >= (right as number);
    case '<=': return (left as number) <= (right as number);
    case '==': return left === right || String(left) === String(right);
    case '!=': return left !== right && String(left) !== String(right);
    default:
      throw new Error(`Unknown operator: ${op}`);
  }
}

export function evaluateExpression(
  expression: string,
  context: ContextObject,
  functions: Map<string, FunctionDef>
): unknown {
  const ast = parseExpression(expression);
  return evaluateAST(ast, context, functions);
}

export interface EvalResult {
  text: string;
  errors: Array<{ expression: string; error: string; start: number; end: number }>;
}

export function evaluateTemplate(
  template: string,
  context: ContextObject,
  functions: Map<string, FunctionDef>
): EvalResult {
  const matches = findMustacheExpressions(template);
  const errors: EvalResult['errors'] = [];

  if (matches.length === 0) {
    return { text: template, errors: [] };
  }

  let result = '';
  let lastIndex = 0;

  for (const match of matches) {
    result += template.slice(lastIndex, match.start);

    if (match.expression === '') {
      result += match.raw;
      errors.push({
        expression: '',
        error: 'Empty expression',
        start: match.start,
        end: match.end,
      });
    } else {
      try {
        const value = evaluateExpression(match.expression, context, functions);
        result += value === null || value === undefined ? '' : String(value);
      } catch (err) {
        result += match.raw;
        errors.push({
          expression: match.expression,
          error: err instanceof Error ? err.message : String(err),
          start: match.start,
          end: match.end,
        });
      }
    }

    lastIndex = match.end;
  }

  result += template.slice(lastIndex);
  return { text: result, errors };
}
