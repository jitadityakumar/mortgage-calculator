import { useState } from 'react';
import type { FormState } from '../types/formState';

interface DebugStateProps {
  form: FormState;
  onImport: (form: FormState) => void;
}

export function DebugState({ form, onImport }: DebugStateProps) {
  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);

  const exportedJson = JSON.stringify(form, null, 2);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(exportedJson);
      setCopyStatus('Copied!');
    } catch {
      setCopyStatus('Copy failed — select the text and copy manually.');
    }
    setTimeout(() => setCopyStatus(null), 2000);
  };

  const handleLoad = () => {
    try {
      const parsed = JSON.parse(importText);
      onImport(parsed);
      setImportError(null);
      setImportText('');
    } catch {
      setImportError('Could not parse that as valid JSON.');
    }
  };

  return (
    <details className="card debug-state">
      <summary>Debug: export / import inputs</summary>
      <div className="debug-state-body">
        <div className="debug-state-section">
          <div className="debug-state-row">
            <span>Current inputs (JSON)</span>
            <button type="button" onClick={handleCopy}>
              Copy to clipboard
            </button>
          </div>
          {copyStatus && <p className="debug-state-status">{copyStatus}</p>}
          <textarea readOnly value={exportedJson} rows={8} />
        </div>

        <div className="debug-state-section">
          <div className="debug-state-row">
            <span>Load inputs from JSON</span>
            <button type="button" onClick={handleLoad} disabled={importText.trim().length === 0}>
              Load
            </button>
          </div>
          {importError && <p className="debug-state-error">{importError}</p>}
          <textarea
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            rows={8}
            placeholder="Paste exported JSON here"
          />
        </div>
      </div>
    </details>
  );
}
