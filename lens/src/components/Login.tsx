import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { login } from '../services/auth';
import EyeOfProvidence from './EyeOfProvidence';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) {
      setError('Username and password are required');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await login(username, password);
      navigate('/');
    } catch (err) {
      if (err instanceof TypeError) {
        setError('Unable to reach server, check your connection');
      } else if (err instanceof Error && err.message === 'Invalid credentials') {
        setError('Invalid credentials');
      } else {
        setError('Something went wrong, try again');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-providence-bg relative overflow-hidden">
      {/* Subtle grid background */}
      <div className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(74,122,181,0.03) 1px, transparent 0)',
          backgroundSize: '24px 24px',
        }}
      />

      {/* Scan line animation */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="w-full h-px bg-gradient-to-r from-transparent via-providence-accent/20 to-transparent animate-scan" />
      </div>

      {/* Eye */}
      <div className="mb-8 animate-fade-in">
        <EyeOfProvidence size={180} trackMouse />
      </div>

      {/* Title */}
      <h1 className="text-3xl font-bold text-providence-accent-bright mb-1 tracking-wider animate-fade-in">
        PROVIDENCE
      </h1>
      <p className="text-xs text-gray-500 tracking-[0.3em] uppercase mb-8 animate-fade-in">
        Per Providentiam, Securitas
      </p>

      {/* Login form */}
      <form onSubmit={handleSubmit}
        className="w-80 space-y-3 animate-fade-in"
        style={{ animationDelay: '0.3s' }}>

        {error && (
          <div className="text-center text-sm text-red-400 bg-red-400/10 rounded py-2">
            {error}
          </div>
        )}

        <input
          type="text"
          placeholder="Username"
          aria-label="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="w-full px-4 py-2.5 bg-providence-surface/50 border border-providence-border rounded-lg text-gray-200 text-sm focus:border-providence-border-focus outline-none transition-colors placeholder:text-gray-600"
          autoFocus
        />
        <input
          type="password"
          placeholder="Password"
          aria-label="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full px-4 py-2.5 bg-providence-surface/50 border border-providence-border rounded-lg text-gray-200 text-sm focus:border-providence-border-focus outline-none transition-colors placeholder:text-gray-600"
        />
        <button
          type="submit"
          disabled={loading}
          className="w-full py-2.5 bg-providence-accent-bright/15 border border-providence-accent-bright/30 text-providence-accent-bright font-medium rounded-lg hover:bg-providence-accent-bright/25 transition-all text-sm tracking-wider uppercase disabled:opacity-50"
        >
          {loading ? 'Authenticating...' : 'Access Terminal'}
        </button>
      </form>

      {/* QR code for mobile access */}
      <div className="mt-8 flex flex-col items-center gap-2 animate-fade-in" style={{ animationDelay: '0.5s' }}>
        <div className="bg-white rounded-lg p-2">
          <img
            src={`https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(window.location.origin)}&bgcolor=ffffff&color=0C1017&format=svg`}
            alt="QR code to access Providence"
            width={120} height={120}
            className="rounded"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
        </div>
        <p className="text-[9px] text-gray-600 tracking-wider">SCAN TO OPEN ON MOBILE</p>
      </div>

      {/* Version */}
      <p className="absolute bottom-4 text-[10px] text-gray-700 tracking-wider">
        PROVIDENCE v1.0
      </p>

      <style>{`
        @keyframes fade-in {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes scan {
          0% { transform: translateY(-100vh); }
          100% { transform: translateY(100vh); }
        }
        .animate-fade-in {
          animation: fade-in 0.8s ease-out both;
        }
        .animate-scan {
          animation: scan 4s linear infinite;
        }
      `}</style>
    </div>
  );
}
