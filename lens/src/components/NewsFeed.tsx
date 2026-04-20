import { useState, useEffect } from 'react';
import { ExternalLink, RefreshCw } from 'lucide-react';

interface NewsItem {
  title: string;
  link: string;
  pubDate: string;
  source: string;
  sourceColor: string;
  description: string;
}

const FEEDS = [
  {
    name: 'The Hacker News',
    url: 'https://feeds.feedburner.com/TheHackersNews',
    color: '#0A9396',
  },
  {
    name: 'Krebs on Security',
    url: 'https://krebsonsecurity.com/feed/',
    color: '#ff6d00',
  },
  {
    name: 'BleepingComputer',
    url: 'https://www.bleepingcomputer.com/feed/',
    color: '#2979ff',
  },
  {
    name: 'Dark Reading',
    url: 'https://www.darkreading.com/rss.xml',
    color: '#b388ff',
  },
  {
    name: 'Threatpost',
    url: 'https://threatpost.com/feed/',
    color: '#ff1744',
  },
];

// Use a public RSS-to-JSON proxy
const RSS_PROXY = 'https://api.rss2json.com/v1/api.json?rss_url=';

async function fetchFeed(feed: typeof FEEDS[number]): Promise<NewsItem[]> {
  try {
    const res = await fetch(`${RSS_PROXY}${encodeURIComponent(feed.url)}`);
    if (!res.ok) return [];
    const data = await res.json();
    if (data.status !== 'ok' || !data.items) return [];
    return data.items.slice(0, 8).map((item: any) => ({
      title: item.title || '',
      link: item.link || '',
      pubDate: item.pubDate || '',
      source: feed.name,
      sourceColor: feed.color,
      description: stripHtml(item.description || '').slice(0, 200),
    }));
  } catch {
    return [];
  }
}

function stripHtml(html: string): string {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div.textContent || div.innerText || '';
}

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  if (isNaN(then)) return '';
  const diff = now - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function NewsFeed() {
  const [articles, setArticles] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState('');

  const loadNews = async () => {
    setLoading(true);
    setError(null);
    try {
      const results = await Promise.all(FEEDS.map(fetchFeed));
      const all = results.flat().sort((a, b) =>
        new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime()
      );
      if (all.length === 0) {
        setError('No articles loaded, RSS proxy may be unavailable');
      }
      setArticles(all);
    } catch {
      setError('Failed to load news feeds');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadNews(); }, []);

  const filtered = sourceFilter
    ? articles.filter(a => a.source === sourceFilter)
    : articles;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-200">Cyber Intel Feed</h2>
          <p className="text-xs text-gray-500">Live from the top cybersecurity news sources</p>
        </div>
        <button onClick={loadNews} disabled={loading}
          className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-providence-accent transition-colors disabled:opacity-50">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {/* Source filter pills */}
      <div className="flex gap-2 flex-wrap">
        <button onClick={() => setSourceFilter('')}
          className={`text-[10px] px-2.5 py-1 rounded-full transition-colors ${
            !sourceFilter ? 'bg-providence-accent/20 text-providence-accent' : 'bg-providence-surface text-gray-500 hover:text-gray-300'
          }`}>
          All
        </button>
        {FEEDS.map(f => (
          <button key={f.name} onClick={() => setSourceFilter(f.name)}
            className={`text-[10px] px-2.5 py-1 rounded-full transition-colors ${
              sourceFilter === f.name ? 'text-white' : 'text-gray-500 hover:text-gray-300'
            }`}
            style={{
              backgroundColor: sourceFilter === f.name ? f.color + '30' : undefined,
              borderColor: sourceFilter === f.name ? f.color : undefined,
            }}>
            {f.name}
          </button>
        ))}
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}
      {loading && <p className="text-gray-500 text-sm">Loading feeds...</p>}

      {!loading && filtered.length > 0 && (
        <div className="space-y-2">
          {filtered.map((article, i) => (
            <a key={`${article.link}-${i}`} href={article.link} target="_blank" rel="noopener noreferrer"
              className="block bg-providence-surface border border-providence-border rounded-lg p-4 hover:border-providence-accent/30 transition-all group">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded"
                      style={{ color: article.sourceColor, backgroundColor: article.sourceColor + '18' }}>
                      {article.source}
                    </span>
                    {article.pubDate && (
                      <span className="text-[10px] text-gray-600">{timeAgo(article.pubDate)}</span>
                    )}
                  </div>
                  <h3 className="text-sm text-gray-200 group-hover:text-providence-accent transition-colors leading-snug">
                    {article.title}
                  </h3>
                  {article.description && (
                    <p className="text-[11px] text-gray-500 mt-1.5 leading-relaxed line-clamp-2">
                      {article.description}
                    </p>
                  )}
                </div>
                <ExternalLink size={14} className="text-gray-600 group-hover:text-providence-accent flex-shrink-0 mt-1" />
              </div>
            </a>
          ))}
        </div>
      )}

      {!loading && filtered.length === 0 && !error && (
        <p className="text-gray-500 text-sm">No articles found</p>
      )}
    </div>
  );
}
