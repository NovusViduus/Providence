import { useState } from 'react';
import { useApi } from '../hooks/useApi';
import { getPlaybooks, updatePlaybook } from '../services/api';
import { isAdmin } from '../services/auth';
import type { Playbook } from '../types/events';

export default function PlaybookEditor() {
  const { data: playbooks, error, refresh } = useApi(() => getPlaybooks(), []);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<Playbook>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const startEdit = (p: Playbook) => {
    setEditing(p.id);
    setSaveError(null);
    setForm({
      minConfidence: p.minConfidence,
      ttlSeconds: p.ttlSeconds,
      enabled: p.enabled,
      description: p.description || '',
    });
  };

  const handleSave = async (id: string) => {
    setSaving(true);
    setSaveError(null);
    try {
      await updatePlaybook(id, form);
      setEditing(null);
      refresh();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const formatActions = (actions: string[] | string): string => {
    if (Array.isArray(actions)) return actions.join(', ');
    try { return JSON.parse(actions).join(', '); } catch { return String(actions); }
  };

  if (!playbooks && !error) return <div className="text-gray-500">Loading...</div>;
  if (error) return <div className="text-red-400 text-sm">Failed to load playbooks: {error}</div>;

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-gray-200">Playbooks</h2>
      {playbooks?.map((p) => (
        <div key={p.id} className="bg-providence-surface border border-providence-border rounded-lg p-4">
          <div className="flex justify-between items-start">
            <div>
              <h3 className="text-sm font-semibold text-gray-200">{p.name}</h3>
              <p className="text-xs text-gray-500">{p.category} · {formatActions(p.actions)}</p>
            </div>
            <span className={`text-xs px-2 py-0.5 rounded ${p.enabled ? 'bg-green-600/20 text-green-400' : 'bg-gray-600/20 text-gray-400'}`}>
              {p.enabled ? 'Enabled' : 'Disabled'}
            </span>
          </div>

          {editing === p.id ? (
            <div className="mt-3 space-y-3">
              {saveError && (
                <div className="text-sm text-red-400 bg-red-400/10 rounded py-1.5 px-3">{saveError}</div>
              )}
              <div className="flex gap-4 flex-wrap">
                <label className="text-xs text-gray-500">
                  Min Confidence
                  <input type="number" step="0.05" min="0" max="1" value={form.minConfidence ?? p.minConfidence}
                    onChange={(e) => setForm({ ...form, minConfidence: parseFloat(e.target.value) })}
                    aria-label="Minimum confidence threshold"
                    className="ml-2 w-20 bg-providence-bg border border-providence-border rounded px-2 py-1 text-sm text-gray-200" />
                </label>
                <label className="text-xs text-gray-500">
                  TTL (seconds)
                  <input type="number" value={form.ttlSeconds ?? p.ttlSeconds}
                    onChange={(e) => setForm({ ...form, ttlSeconds: parseInt(e.target.value) })}
                    aria-label="Block TTL in seconds"
                    className="ml-2 w-24 bg-providence-bg border border-providence-border rounded px-2 py-1 text-sm text-gray-200" />
                </label>
                <label className="text-xs text-gray-500 flex items-center gap-2">
                  Enabled
                  <input type="checkbox" checked={form.enabled ?? p.enabled}
                    onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
                    aria-label="Playbook enabled" />
                </label>
              </div>
              <label className="text-xs text-gray-500 block">
                Description
                <textarea value={form.description ?? p.description ?? ''}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  aria-label="Playbook description"
                  className="mt-1 w-full bg-providence-bg border border-providence-border rounded px-2 py-1.5 text-sm text-gray-200"
                  rows={2} />
              </label>
              <div className="flex gap-2">
                <button onClick={() => handleSave(p.id)} disabled={saving}
                  className="text-xs px-3 py-1 bg-providence-accent/20 text-providence-accent rounded hover:bg-providence-accent/30 disabled:opacity-50">
                  {saving ? 'Saving...' : 'Save'}
                </button>
                <button onClick={() => { setEditing(null); setSaveError(null); }}
                  className="text-xs px-3 py-1 bg-gray-600/20 text-gray-400 rounded hover:bg-gray-600/30">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-2 flex items-center justify-between text-xs text-gray-500">
              <span>Confidence ≥ {p.minConfidence} · TTL {p.ttlSeconds}s · {p.description || 'No description'}</span>
              {isAdmin() && (
                <button onClick={() => startEdit(p)} className="text-providence-accent hover:underline flex-shrink-0 ml-4">
                  Edit
                </button>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
