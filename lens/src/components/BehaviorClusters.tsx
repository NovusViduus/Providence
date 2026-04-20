import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import clusterData from '../data/clusters.json';

const TOOLTIP_STYLE = { backgroundColor: '#0C1017', border: '1px solid #1E2A3A', borderRadius: '8px', fontSize: '11px' };

interface Cluster {
  id: string;
  name: string;
  color: string;
  icon: string;
  description: string;
  typicalCommands: string[];
  percentage: number;
  avgSessionDuration: number;
  exampleIps: string[];
}

const clusters = clusterData.clusters as Cluster[];

export default function BehaviorClusters() {
  const [selected, setSelected] = useState<Cluster | null>(null);
  const navigate = useNavigate();

  const pieData = clusters.map(c => ({ name: c.name, value: c.percentage, color: c.color }));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-200 mb-1">Attacker Behavior Clusters</h2>
        <p className="text-xs text-gray-500">
          Unsupervised clustering of {clusterData.sessionsWithCommands.toLocaleString()} Cowrie sessions with shell commands
          (out of {clusterData.totalSessions.toLocaleString()} total). {clusterData.method}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Pie chart */}
        <div className="bg-providence-surface border border-providence-border rounded-lg p-4">
          <h3 className="text-sm text-gray-400 mb-3">Distribution</h3>
          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} innerRadius={45}
                onClick={(_, idx) => setSelected(clusters[idx])}>
                {pieData.map((d, i) => (
                  <Cell key={d.name} fill={d.color} stroke="transparent"
                    opacity={selected ? (selected.name === d.name ? 1 : 0.3) : 0.85}
                    className="cursor-pointer transition-opacity" />
                ))}
              </Pie>
              <Tooltip contentStyle={TOOLTIP_STYLE} itemStyle={{ color: '#e5e7eb' }}
                formatter={(value: number) => [`${value}%`, 'Sessions']} />
            </PieChart>
          </ResponsiveContainer>
          <div className="space-y-1 mt-2">
            {clusters.map(c => (
              <button key={c.id} onClick={() => setSelected(selected?.id === c.id ? null : c)}
                className={`w-full flex items-center gap-2 px-2 py-1 rounded text-left transition-all ${
                  selected?.id === c.id ? 'bg-providence-accent/10' : 'hover:bg-white/[0.02]'
                }`}>
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: c.color }} />
                <span className="text-xs text-gray-300 flex-1">{c.name}</span>
                <span className="text-[10px] text-gray-500 font-mono">{c.percentage}%</span>
              </button>
            ))}
          </div>
        </div>

        {/* Cluster cards */}
        <div className="md:col-span-2 space-y-3">
          {(selected ? [selected] : clusters).map(c => (
            <div key={c.id} className="bg-providence-surface border border-providence-border rounded-lg p-4"
              style={{ borderLeftColor: c.color, borderLeftWidth: 3 }}>
              <div className="flex items-center gap-3 mb-2">
                <span className="text-2xl">{c.icon}</span>
                <div>
                  <h4 className="text-sm font-semibold text-gray-200">{c.name}</h4>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded"
                    style={{ color: c.color, backgroundColor: c.color + '18' }}>
                    {c.percentage}% of sessions
                  </span>
                </div>
                <div className="ml-auto text-right">
                  <p className="text-xs text-gray-500">Avg session</p>
                  <p className="text-sm font-mono text-gray-300">{c.avgSessionDuration}s</p>
                </div>
              </div>

              <p className="text-xs text-gray-400 leading-relaxed mb-3">{c.description}</p>

              {/* Typical commands */}
              <div className="mb-3">
                <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5">Typical Commands</p>
                <div className="bg-providence-bg rounded-lg p-3 font-mono text-[11px] text-gray-400 space-y-0.5">
                  {c.typicalCommands.map((cmd, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="text-providence-accent/50">$</span>
                      <span>{cmd}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Example IPs */}
              <div>
                <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5">Example Attackers</p>
                <div className="flex flex-wrap gap-2">
                  {c.exampleIps.map(ip => (
                    <button key={ip} onClick={() => navigate(`/dossier/${encodeURIComponent(ip)}`)}
                      className="text-[10px] font-mono px-2 py-1 rounded bg-providence-bg border border-providence-border/50 text-gray-400 hover:text-providence-accent hover:border-providence-accent/30 transition-colors">
                      {ip}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
