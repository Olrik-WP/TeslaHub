import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { login } from '../api/client';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await login(username, password);
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-dvh flex items-center justify-center bg-[#0a0a0a] p-4">
      <form
        onSubmit={handleSubmit}
        className="bg-[#141414] border border-[#2a2a2a] rounded-2xl p-8 w-full max-w-sm"
      >
        <h1 className="text-2xl font-bold text-center mb-2">TeslaHub</h1>
        <p className="text-[#9ca3af] text-center text-sm mb-8">
          Connect to your dashboard
        </p>

        {error && (
          <div className="bg-red-900/30 border border-red-800 text-red-300 rounded-lg p-3 mb-4 text-sm">
            {error}
          </div>
        )}

        <input
          type="text"
          placeholder="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="w-full bg-[#0a0a0a] border border-[#2a2a2a] rounded-lg px-4 py-3 mb-3 text-white placeholder-[#6b7280] focus:border-[#e31937] focus:outline-none text-base"
          autoComplete="username"
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full bg-[#0a0a0a] border border-[#2a2a2a] rounded-lg px-4 py-3 mb-6 text-white placeholder-[#6b7280] focus:border-[#e31937] focus:outline-none text-base"
          autoComplete="current-password"
        />

        <button
          type="submit"
          disabled={loading || !username || !password}
          className="w-full bg-[#e31937] text-white rounded-lg py-3 font-medium text-base disabled:opacity-50 min-h-[48px] active:bg-[#c0152f] transition-colors duration-150"
        >
          {loading ? 'Connecting...' : 'Login'}
        </button>
      </form>
    </div>
  );
}
