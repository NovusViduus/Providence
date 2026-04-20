import { useState } from 'react';
import heatmapData from '../data/command_heatmap.json';

interface Command {
  cmd: string;
  count: number;
  pct: number;
}

interface Category {
  name: string;
  color: string;
  total: number;
  commands: Command[];
}

const categories = heatmapData.categories as Category[];
const maxCategoryTotal = Math.max(...categories.map(c => c.total));

export default function CommandHeatmap() {
  const [selected, setSelected] = useState<Category | null>(null);
  const [hoveredCmd, setHoveredCmd] = useState<Command | null>(null);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-200 mb-1">Command Heatmap</h2>
        <p className="text-xs text-gray-500">
          {heatmapData.totalCommands.toLocaleString()} commands from {heatmapData.sessionsWithCommands.toLocaleString()} sessions
          with shell activity (out of {heatmapData.totalSessions.toLocaleString()} total). Grouped by MITRE ATT&CK-aligned tactics.
        </p>
      </div>

      {/* Treemap */}
      <div className="bg-providence-surface border border-providence-border rounded-lg p-4">
        <h3 className="text-sm text-gray-400 mb-3">Attack Tactics</h3>
        <div className="flex gap-1.5 h-24">
          {categories.map(cat => {
            const widthPct = (cat.total / heatmapData.totalCommands) * 100;
            return (
              <button key={cat.name}
                onClick={() => setSelected(selected?.name === cat.name ? null : cat)}
                onMouseEnter={() => !selected && setSelected(cat)}
                className={`rounded-lg transition-all relative overflow-hidden group ${
                  selected?.name === cat.name ? 'ring-1 ring-white/20' : ''
                }`}
                style={{
                  width: `${widthPct}%`,
                  backgroundColor: cat.color + '20',
                  borderLeft: `3px solid ${cat.color}`,
                }}>
                <div className="absolute inset-0 flex flex-col items-center justify-center px-1">
                  <span className="text-[10px] font-semibold text-gray-200 text-center leading-tight truncate w-full">
                    {cat.name}
                  </span>
                  <span className="text-[9px] font-mono mt-0.5" style={{ color: cat.color }}>
                    {cat.total.toLocaleString()}
                  </span>
                  <span className="text-[8px] text-gray-500">
                    {((cat.total / heatmapData.totalCommands) * 100).toFixed(0)}%
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Detail view */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Category breakdown bars */}
        <div className="bg-providence-surface border border-providence-border rounded-lg p-4">
          <h3 className="text-sm text-gray-400 mb-3">
            {selected ? selected.name : 'All Categories'}
          </h3>
          <div className="space-y-2">
            {(selected ? [selected] : categories).map(cat => (
              <button key={cat.name}
                onClick={() => setSelected(selected?.name === cat.name ? null : cat)}
                className="w-full text-left">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: cat.color }} />
                    <span className="text-xs text-gray-300">{cat.name}</span>
                  </div>
                  <span className="text-xs font-mono text-gray-400">{cat.total.toLocaleString()}</span>
                </div>
                <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all"
                    style={{
                      width: `${(cat.total / maxCategoryTotal) * 100}%`,
                      backgroundColor: cat.color,
                      opacity: selected && selected.name !== cat.name ? 0.3 : 0.8,
                    }} />
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Individual commands */}
        <div className="bg-providence-surface border border-providence-border rounded-lg p-4">
          <h3 className="text-sm text-gray-400 mb-3">
            {selected ? `${selected.name} Commands` : 'Top Commands'}
          </h3>
          <div className="space-y-1">
            {(selected ? selected.commands : categories.flatMap(c => c.commands).sort((a, b) => b.count - a.count).slice(0, 12))
              .map((cmd, i) => {
                const cat = categories.find(c => c.commands.includes(cmd));
                const maxCount = selected
                  ? selected.commands[0].count
                  : categories.flatMap(c => c.commands).sort((a, b) => b.count - a.count)[0].count;
                return (
                  <div key={cmd.cmd + i}
                    onMouseEnter={() => setHoveredCmd(cmd)}
                    onMouseLeave={() => setHoveredCmd(null)}
                    className="flex items-center gap-3 py-1.5 px-2 rounded hover:bg-white/[0.02] transition-colors">
                    <span className="text-[10px] text-gray-600 w-4 text-right">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <code className="text-[11px] font-mono text-gray-300 truncate">{cmd.cmd}</code>
                        {cat && !selected && (
                          <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: cat.color }} />
                        )}
                      </div>
                      <div className="h-1 bg-gray-800 rounded-full overflow-hidden mt-1">
                        <div className="h-full rounded-full"
                          style={{
                            width: `${(cmd.count / maxCount) * 100}%`,
                            backgroundColor: cat?.color || '#0A9396',
                          }} />
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0 w-16">
                      <span className="text-[10px] font-mono text-gray-400">{cmd.count.toLocaleString()}</span>
                      <span className="text-[9px] text-gray-600 ml-1">{cmd.pct}%</span>
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      </div>

      {/* Hover detail */}
      {hoveredCmd && (
        <div className="bg-providence-surface border border-providence-border rounded-lg p-4">
          <div className="flex items-center gap-4">
            <code className="text-sm font-mono text-providence-accent">{hoveredCmd.cmd}</code>
            <span className="text-xs text-gray-400">
              Observed {hoveredCmd.count.toLocaleString()} times ({hoveredCmd.pct}% of all commands)
            </span>
          </div>
        </div>
      )}

      <p className="text-[10px] text-gray-700 text-center">
        Commands extracted from Cowrie SSH honeypot session logs. Patterns normalized and grouped by MITRE ATT&CK tactics.
      </p>
    </div>
  );
}
