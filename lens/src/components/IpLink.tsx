import { useNavigate } from 'react-router-dom';

export default function IpLink({ ip, className = '' }: { ip: string; className?: string }) {
  const navigate = useNavigate();
  return (
    <button
      onClick={(e) => { e.stopPropagation(); navigate(`/dossier/${encodeURIComponent(ip)}`); }}
      className={`font-mono hover:text-providence-accent hover:underline transition-colors cursor-pointer ${className}`}
    >
      {ip}
    </button>
  );
}
