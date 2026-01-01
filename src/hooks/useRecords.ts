import { useState, useEffect, useCallback } from 'react';
import type { Record, NewRecord } from '../db/schema';

/**
 * Hook for managing records - types are automatically derived from schema
 */
export function useRecords() {
  const [records, setRecords] = useState<Record[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const loadRecords = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await window.electronAPI.records.getAll();
      setRecords(data);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to load records'));
      console.error('Error loading records:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const createRecord = useCallback(async (input: Partial<NewRecord> = { title: 'New Record' }) => {
    try {
      setLoading(true);
      setError(null);
      // Filter out undefined values to prevent database errors
      const cleanInput = Object.fromEntries(
        Object.entries(input).filter(([, value]) => value !== undefined)
      ) as Partial<NewRecord>;
      const newRecord = await window.electronAPI.records.create(cleanInput);
      await loadRecords(); // Refresh the list
      return newRecord;
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to create record'));
      console.error('Error creating record:', err);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [loadRecords]);

  useEffect(() => {
    loadRecords();
  }, [loadRecords]);

  return {
    records,
    loading,
    error,
    loadRecords,
    createRecord,
  };
}
