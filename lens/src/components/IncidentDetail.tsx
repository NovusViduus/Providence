import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Pencil, Trash2, X, Check } from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { getIncident, updateIncident } from '../services/api';
import { displayTier } from '../utils/tier';
import { isAdmin } from '../services/auth';
import { useState } from 'react';

interface Note { text: string; timestamp: string; }

function parseNotes(raw?: string): Note[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch { /* fall through */ }
  // Legacy: plain text notes, convert each non-empty line to a note
  return raw.split('\n').filter(l => l.trim()).map(text => ({ text, timestamp: '' }));
}

function serializeNotes(notes: Note[]): string {
  return JSON.stringify(notes);
}

export default function IncidentDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: incident, error, refresh } = useApi(() => getIncident(id!), [id]);
  const [newNote, setNewNote] = useState('');
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editText, setEditText] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  if (!incident) {
    if (error) return <div className="text-red-400 text-sm">Failed to load incident: {error}</div>;
    return <div className="text-gray-500">Loading...</div>;
  }

  const existingNotes = parseNotes(incident.notes);

  const saveNotes = async (updated: Note[]) => {
    setActionError(null);
    try {
      await updateIncident(id!, { notes: serializeNotes(updated) });
      refresh();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Failed to update notes');
    }
  };

  const handleAddNote = async () => {
    if (!newNote.trim()) return;
    const updated = [...existingNotes, { text: newNote.trim(), timestamp: new Date().toISOString() }];
    await saveNotes(updated);
    setNewNote('');
  };

  const handleDeleteNote = async (idx: number) => {
    const updated = existingNotes.filter((_, i) => i !== idx);
    await saveNotes(updated);
  };

  const handleStartEdit = (idx: number) => {
    setEditingIdx(idx);
    setEditText(existingNotes[idx].text);
  };

  const handleSaveEdit = async () => {
    if (editingIdx === null || !editText.trim()) return;
    const updated = existingNotes.map((n, i) =>
      i === editingIdx ? { ...n, text: editText.trim() } : n
    );
    await saveNotes(updated);
    setEditingIdx(null);
    setEditText('');
  };

  const handleCancelEdit = () => {
    setEditingIdx(null);
    setEditText('');
  };

  const handleResolve = async () => {
    setActionError(null);
    try {
      await updateIncident(id!, { resolved: true });
      refresh();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Failed to resolve');
    }
  };

  return (
    <div className="space-y-6">
      <button onClick={() => navigate('/incidents')}
        className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-providence-accent transition-colors mb-2">
        <ArrowLeft size={16} /> Back to Incidents
      </button>
      {actionError && (
        <div className="text-sm text-red-400 bg-red-400/10 rounded py-2 px-4">{actionError}</div>
      )}
      <h2 className="text-lg font-semibold text-gray-200">Incident: {incident.id}</h2>
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Source IP', value: incident.sourceIp },
          { label: 'Category', value: incident.category },
          { label: 'Confidence', value: `${(incident.confidence * 100).toFixed(1)}%` },
          { label: 'Tier', value: displayTier(incident) },
          { label: 'Resolved', value: incident.resolved ? 'Yes' : 'No' },
          { label: 'Pending Approval', value: incident.pendingApproval ? 'Yes' : 'No' },
          { label: 'Created', value: new Date(incident.createdAt).toLocaleString() },
          { label: 'Resolved At', value: incident.resolvedAt ? new Date(incident.resolvedAt).toLocaleString() : '-' },
          { label: 'Actions', value: Array.isArray(incident.actionsTaken) ? incident.actionsTaken.join(', ') : incident.actionsTaken },
        ].map(({ label, value }) => (
          <div key={label} className="bg-providence-surface border border-providence-border rounded p-3">
            <p className="text-xs text-gray-500">{label}</p>
            <p className="text-sm text-gray-200">{value}</p>
          </div>
        ))}
      </div>
      {/* Notes section */}
      <div className="bg-providence-surface border border-providence-border rounded-lg p-4">
        <h3 className="text-sm text-gray-400 mb-3">Notes ({existingNotes.length})</h3>
        {existingNotes.length > 0 ? (
          <div className="space-y-2">
            {existingNotes.map((n, idx) => (
              <div key={idx} className="flex items-start gap-3 bg-providence-bg rounded px-3 py-2">
                {editingIdx === idx ? (
                  <div className="flex-1 flex gap-2">
                    <textarea value={editText} onChange={(e) => setEditText(e.target.value)}
                      className="flex-1 bg-providence-surface border border-providence-border rounded px-2 py-1 text-sm text-gray-200" rows={2} />
                    <button onClick={handleSaveEdit} className="text-green-400 hover:text-green-300" aria-label="Save edit">
                      <Check size={14} />
                    </button>
                    <button onClick={handleCancelEdit} className="text-gray-500 hover:text-gray-300" aria-label="Cancel edit">
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="flex-1">
                      <p className="text-sm text-gray-300">{n.text}</p>
                      {n.timestamp && (
                        <p className="text-[10px] text-gray-600 mt-1">{new Date(n.timestamp).toLocaleString()}</p>
                      )}
                    </div>
                    {isAdmin() && (
                      <div className="flex gap-1.5 pt-0.5">
                        <button onClick={() => handleStartEdit(idx)} className="text-gray-500 hover:text-providence-accent" aria-label="Edit note">
                          <Pencil size={13} />
                        </button>
                        <button onClick={() => handleDeleteNote(idx)} className="text-gray-500 hover:text-red-400" aria-label="Delete note">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
        ) : <p className="text-gray-600 text-sm">No notes yet</p>}

        {isAdmin() && (
          <div className="mt-3 flex gap-2">
            <textarea value={newNote} onChange={(e) => setNewNote(e.target.value)} placeholder="Add a note..."
              className="flex-1 bg-providence-bg border border-providence-border rounded px-3 py-2 text-sm text-gray-200" rows={2} />
            <button onClick={handleAddNote} disabled={!newNote.trim()}
              className="self-end text-xs px-3 py-1.5 bg-providence-accent/20 text-providence-accent rounded hover:bg-providence-accent/30 disabled:opacity-30">
              Add
            </button>
          </div>
        )}
      </div>

      <div className="bg-providence-surface border border-providence-border rounded-lg p-4">
        <h3 className="text-sm text-gray-400 mb-3">Timeline</h3>
        <div className="flex items-center gap-0">
          <div className="flex flex-col items-center">
            <div className="w-3 h-3 rounded-full bg-providence-accent" />
            <p className="text-xs text-gray-500 mt-1">Detected</p>
            <p className="text-xs text-gray-400">{new Date(incident.createdAt).toLocaleTimeString()}</p>
          </div>
          <div className="flex-1 h-0.5 bg-providence-border mx-2" />
          <div className="flex flex-col items-center">
            <div className={`w-3 h-3 rounded-full ${incident.actionsTaken ? 'bg-yellow-500' : 'bg-gray-600'}`} />
            <p className="text-xs text-gray-500 mt-1">Action</p>
            <p className="text-xs text-gray-400">{Array.isArray(incident.actionsTaken) ? incident.actionsTaken.join(', ') : incident.actionsTaken || '-'}</p>
          </div>
          <div className="flex-1 h-0.5 bg-providence-border mx-2" />
          <div className="flex flex-col items-center">
            <div className={`w-3 h-3 rounded-full ${incident.resolved ? 'bg-green-500' : 'bg-gray-600'}`} />
            <p className="text-xs text-gray-500 mt-1">{incident.resolved ? 'Resolved' : 'Open'}</p>
            <p className="text-xs text-gray-400">{incident.resolvedAt ? new Date(incident.resolvedAt).toLocaleTimeString() : '-'}</p>
          </div>
        </div>
      </div>
      {isAdmin() && !incident.resolved && (
        <div className="flex justify-end">
          <button onClick={handleResolve} className="text-xs px-3 py-1.5 bg-green-600/20 text-green-400 rounded hover:bg-green-600/30">
            Mark Resolved
          </button>
        </div>
      )}
    </div>
  );
}
