import { useEffect, useState } from 'react';
import { deleteSavedCalculation, listSavedCalculations } from '../api/client';
import type { SavedCalculationSummary } from '../api/types';

interface SavedCalculationsListProps {
  /** Bump this to trigger a refetch (e.g. after a save elsewhere). */
  refreshToken: number;
  onLoad: (id: number) => void;
}

function formatCreatedAt(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function SavedCalculationsList({ refreshToken, onLoad }: SavedCalculationsListProps) {
  const [items, setItems] = useState<SavedCalculationSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Ids deleted locally, so a refetch already in flight when a delete
  // happens can't resurrect the row when it resolves after the delete —
  // the fetch effect below filters its result against this set too, not
  // just optimistic local removal.
  const [deletedIds, setDeletedIds] = useState<Set<number>>(new Set());
  const [deletingIds, setDeletingIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    let cancelled = false;
    listSavedCalculations()
      .then((result) => {
        if (cancelled) return;
        setItems(result.filter((item) => !deletedIds.has(item.id)));
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        console.error('Failed to load saved calculations:', err);
        setError('Could not load saved calculations.');
      });
    return () => {
      cancelled = true;
    };
    // deletedIds deliberately excluded: it's consulted, not a trigger — a
    // delete already updates `items` itself and shouldn't cause a refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshToken]);

  const handleDelete = async (id: number) => {
    if (deletingIds.has(id)) return;
    setDeletingIds((prev) => new Set(prev).add(id));
    try {
      await deleteSavedCalculation(id);
      setDeletedIds((prev) => new Set(prev).add(id));
      setItems((prev) => prev.filter((item) => item.id !== id));
      setError(null);
    } catch (err) {
      console.error('Failed to delete saved calculation:', err);
      setError('Could not delete that calculation.');
    } finally {
      setDeletingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  return (
    <div className="card">
      <div className="lump-sums-header">
        <span className="field-label">Saved calculations</span>
      </div>
      {error && <p className="field-hint">{error}</p>}
      {items.length === 0 && !error && <p className="field-hint">None saved yet.</p>}
      {items.map((item) => (
        <div className="lump-sum-row" key={item.id}>
          <button type="button" className="disclosure" onClick={() => onLoad(item.id)}>
            {item.name} — {formatCreatedAt(item.createdAt)}
          </button>
          <button
            type="button"
            className="btn-remove"
            aria-label={`Delete ${item.name}`}
            onClick={() => handleDelete(item.id)}
            disabled={deletingIds.has(item.id)}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
