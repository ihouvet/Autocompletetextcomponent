import { useState, useMemo } from 'react';
import { AutocompleteTextArea } from './components/AutocompleteTextArea';
import { testContext } from './engine/context';
import { functionRegistry } from './engine/functions';
import { evaluateTemplate } from './engine/evaluator';
import type { EvalResult } from './engine/evaluator';
import type { FunctionDef } from './engine/types';
import './App.css';

const INITIAL_TEXT = `Hello {{UPPER(Myobject1.dyntext11)}}! The value is {{Myobject2.child2.myVar1}}.
Is it big? {{IF(Myobject2.child2.myVar1 > 10, "yes, it is big", "no, it is small")}}.
Combined: {{CONCAT(Myobject1.dyntext11, " & ", Myobject1.dyntext12)}}
Today is: {{TODAY()}}`;

function App() {
  const [text, setText] = useState(INITIAL_TEXT);

  const result: EvalResult = useMemo(() => {
    return evaluateTemplate(text, testContext, functionRegistry);
  }, [text]);

  // Group functions by category for the reference panel
  const groupedFunctions = useMemo(() => {
    const groups = new Map<string, FunctionDef[]>();
    for (const [, fn] of functionRegistry) {
      const list = groups.get(fn.category) || [];
      list.push(fn);
      groups.set(fn.category, list);
    }
    return groups;
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <h1>Dynamic Text Editor</h1>
        <p>
          Type free text mixed with <code>{'{{'}</code>expressions<code>{'}}'}</code>.
          Autocomplete appears inside mustache braces.
        </p>
      </header>

      <div className="main-layout">
        {/* Left column: editor + result */}
        <div>
          <div className="card">
            <h2>Editor</h2>
            <AutocompleteTextArea
              value={text}
              onChange={setText}
              context={testContext}
              functions={functionRegistry}
              placeholder="Type text here... Use {{ to start a dynamic expression"
              rows={8}
            />
            <div className="tip-bar">
              Type <code>{'{{'}</code> to see available objects and functions.
              Use dot notation for nested properties: <code>{'{{Myobject2.child2.myVar1}}'}</code>
            </div>
          </div>

          <div className="card result-panel">
            <h2>Evaluated Result</h2>
            <div className={`result-content ${result.errors.length > 0 ? 'has-errors' : ''}`}>
              {result.text}
            </div>
            {result.errors.length > 0 && (
              <div className="error-list">
                {result.errors.map((err, i) => (
                  <div key={i} className="error-item">
                    <span className="error-expr">
                      {err.expression ? `{{${err.expression}}}` : '{{}}'}
                    </span>
                    <span className="error-msg">{err.error}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right column: context + function reference */}
        <div>
          <div className="card">
            <h2>Test Data (Context)</h2>
            <div className="context-panel">
              <div className="context-obj">
                <div className="context-obj-name">Myobject1</div>
                <div className="context-prop">
                  .dyntext11 = <span className="prop-val">"dyntext11"</span>
                </div>
                <div className="context-prop">
                  .dyntext12 = <span className="prop-val">"dyntext12"</span>
                </div>
              </div>
              <div className="context-obj">
                <div className="context-obj-name">Myobject2</div>
                <div className="context-prop">
                  .child2.myVar1 = <span className="prop-val">12</span>
                </div>
              </div>
            </div>
          </div>

          <div className="card">
            <h2>Function Reference</h2>
            <div className="fn-reference">
              {Array.from(groupedFunctions.entries()).map(([category, fns]) => (
                <div key={category} className="fn-category">
                  <div className={`fn-category-title ${category}`}>{category}</div>
                  {fns.map((fn) => {
                    const argStr = fn.args
                      .filter(a => a.name !== '...more')
                      .map((a) => a.optional ? `${a.name}?` : a.name)
                      .join(', ');
                    return (
                      <div key={fn.name} className="fn-item">
                        <span className="fn-item-name">
                          {fn.name}({argStr})
                        </span>
                        <span className="fn-item-desc"> — {fn.description}</span>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
