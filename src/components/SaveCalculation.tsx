import { useEffect, useRef, useState } from 'react';
import { saveCalculation } from '../api/client';
import type { MortgageInputs } from '../api/types';

interface SaveCalculationProps {
  inputs: MortgageInputs;
  /** False while the current inputs fail validation — saving them would
   * just produce a saved calculation that errors on every future load. */
  canSave: boolean;
  onSaved: () => void;
}

export function SaveCalculation({ inputs, canSave, onSaved }: SaveCalculationProps) {
  const [name, setName] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const statusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (statusTimer.current) clearTimeout(statusTimer.current);
    };
  }, []);

  const handleSave = async () => {
    if (name.trim() === '') return;
    setIsSaving(true);
    setStatus(null);
    try {
      await saveCalculation(name.trim(), inputs);
      setName('');
      setStatus('Saved.');
      onSaved();
    } catch (err) {
      console.error('Failed to save calculation:', err);
      setStatus('Could not save — please try again.');
    } finally {
      setIsSaving(false);
      if (statusTimer.current) clearTimeout(statusTimer.current);
      statusTimer.current = setTimeout(() => setStatus(null), 3000);
    }
  };

  return (
    <div className="card">
      <div className="lump-sums-header">
        <span className="field-label">Save this calculation</span>
      </div>
      <div className="field-grid">
        <label className="field field-inline">
          <span className="field-label">Name</span>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Base case" />
        </label>
        <button
          type="button"
          className="btn-secondary"
          onClick={handleSave}
          disabled={!canSave || isSaving || name.trim() === ''}
        >
          {isSaving ? 'Saving…' : 'Save'}
        </button>
      </div>
      {!canSave && <p className="field-hint">Waiting for a valid calculation before you can save.</p>}
      {status && <p className="field-hint" aria-live="polite">{status}</p>}
    </div>
  );
}
