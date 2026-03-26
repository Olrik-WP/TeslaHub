import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { login } from '../api/client';

const SAVED_USER_KEY = 'teslahub_saved_user';

export default function Login() {
  const [username, setUsername] = useState(() => localStorage.getItem(SAVED_USER_KEY) ?? '');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(() => !!localStorage.getItem(SAVED_USER_KEY));
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { t } = useTranslation();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await login(username, password);
      if (remember) {
        localStorage.setItem(SAVED_USER_KEY, username);
      } else {
        localStorage.removeItem(SAVED_USER_KEY);
      }
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.invalidCredentials'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-dvh flex items-center justify-center bg-[#0a0a0a] p-4">
      <form
        name="login"
        onSubmit={handleSubmit}
        className="bg-[#141414] border border-[#2a2a2a] rounded-2xl p-8 w-full max-w-sm"
      >
        <h1 className="text-2xl font-bold text-center mb-2">TeslaHub</h1>
        <p className="text-[#9ca3af] text-center text-sm mb-8">
          {t('auth.subtitle')}
        </p>

        {error && (
          <div className="bg-red-900/30 border border-red-800 text-red-300 rounded-lg p-3 mb-4 text-sm">
            {error}
          </div>
        )}

        <input
          id="username"
          name="username"
          type="text"
          placeholder={t('auth.username')}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="w-full bg-[#0a0a0a] border border-[#2a2a2a] rounded-lg px-4 py-3 mb-3 text-white placeholder-[#6b7280] focus:border-[#e31937] focus:outline-none text-base"
          autoComplete="username"
        />
        <input
          id="password"
          name="password"
          type="password"
          placeholder={t('auth.password')}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full bg-[#0a0a0a] border border-[#2a2a2a] rounded-lg px-4 py-3 mb-4 text-white placeholder-[#6b7280] focus:border-[#e31937] focus:outline-none text-base"
          autoComplete="current-password"
        />

        <label className="flex items-center gap-2 mb-6 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            className="w-4 h-4 rounded border-[#2a2a2a] bg-[#0a0a0a] accent-[#e31937]"
          />
          <span className="text-sm text-[#9ca3af]">{t('auth.rememberMe')}</span>
        </label>

        <button
          type="submit"
          disabled={loading || !username || !password}
          className="w-full bg-[#e31937] text-white rounded-lg py-3 font-medium text-base disabled:opacity-50 min-h-[48px] active:bg-[#c0152f] transition-colors duration-150"
        >
          {loading ? t('auth.loggingIn') : t('auth.login')}
        </button>
      </form>
    </div>
  );
}
