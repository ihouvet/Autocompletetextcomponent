import { useState, useMemo } from 'react';
import { AutocompleteTextArea } from './components/AutocompleteTextArea';
import { testContext } from './engine/context';
import { functionRegistry } from './engine/functions';
import { evaluateTemplate } from './engine/evaluator';
import type { FunctionDef } from './engine/types';
import './App.css';

const INITIAL_TEXT = `Hello {{UPPER(Myobject1.dyntext11)}}!

The value of myVar1 is {{Myobject2.child2.myVar1}} and it is {{IF(Myobject2.child2.myVar1 > 10, "big", "small")}}.

Combined: {{CONCAT(Myobject1.dyntext11, " + ", Myobject1.dyntext12)}}
Length: {{LEN(Myobject1.dyntext11)}} characters
Today: {{TODAY()}}`;

function App() {
  const [text, setText] = useState(INITIAL_TEXT);

  const evalResult = useMemo(
    () => evaluateTemplate(text, testContext, functionRegistry),
    [text]
  );

  // Group functions by category for the reference panel
  const groupedFunctions = useMemo(() => {
    const groups: Record<string, FunctionDef[]> = {};
    for (const [, fn] of functionRegistry) {
      if (!groups[fn.category]) groups[fn.category] = [];
      groups[fn.category].push(fn);
    }
    return groups;
  }, []);

  const categoryColors: Record<string, string> = {
    String: '#1d4ed8',
    Date: '#92400e',
    Number: '#065f46',
    Logic: '#9d174d',
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>Dynamic Text Area</h1>
        <p>
          Type free text mixed with <code>{'{{expressions}}'}</code>. Use{' '}
          <kbd>{'{{'}{'}'}</kbd> to trigger autocomplete.
        </p>
      </header>

      <div className="app-layout">
        <main className="app-main">
          <section className="editor-section">
            <h2>Editor</h2>
            <AutocompleteTextArea
              value={text}
              onChange={setText}
              context={testContext}
              functions={functionRegistry}
              placeholder="Type text here... Use {{ to insert dynamic expressions"
              rows={10}
            />
          </section>

          <section className="result-section">
            <h2>Evaluated Result</h2>
            <div className="result-box">
              <pre className="result-text">{evalResult.text}</pre>
            </div>
            {evalResult.errors.length > 0 && (
              <div className="errors">
                <h3>Errors</h3>
                {evalResult.errors.map((err, i) => (
                  <div key={i} className="error-item">
                    <code>{`{{${err.expression}}}`}</code>
                    <span>{err.error}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="context-section">
            <h2>Test Data</h2>
            <pre className="context-box">{JSON.stringify(testContext, null, 2)}</pre>
          </section>
        </main>

        <aside className="app-sidebar">
          <h2>Function Reference</h2>
          {Object.entries(groupedFunctions).map(([category, fns]) => (
            <div key={category} className="fn-group">
              <h3 style={{ color: categoryColors[category] }}>{category}</h3>
              {fns.map((fn) => {
                const argStr = fn.args
                  .filter((a) => a.name !== '...more')
                  .map((a) => a.name)
                  .join(', ');
                const optionalArgs = fn.args.filter(
                  (a) => a.optional && a.name !== '...more'
                );
                return (
                  <div key={fn.name} className="fn-item">
                    <div className="fn-sig">
                      {fn.name}({argStr})
                    </div>
                    <div className="fn-desc">{fn.description}</div>
                    {fn.args.length > 0 && (
                      <div className="fn-args">
                        {fn.args.map((a, i) => (
                          <span key={i} className="fn-arg">
                            {a.name}
                            {a.optional ? '?' : ''}: {a.description}
                          </span>
                        ))}
                      </div>
                    )}
                    {optionalArgs.length > 0 && (
                      <div className="fn-optional">Optional args available</div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </aside>
      </div>
    </div>
  );
}

export default App;
