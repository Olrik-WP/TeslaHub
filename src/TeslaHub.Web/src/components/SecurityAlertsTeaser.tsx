import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';

const DISMISS_KEY = 'teslahub_security_teaser_dismissed';

type TeslaOAuthStatus = {
  configured: boolean;
  connected: boolean;
};

/**
 * Reminds the user that Security Alerts exist when they have not been
 * configured yet. Shown on the Home page above the dashboard. Dismissible
 * (state persisted in localStorage). Hidden once the feature is connected.
 */
export default function SecurityAlertsTeaser() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DISMISS_KEY) === '1');

  const { data: status } = useQuery<TeslaOAuthStatus>({
    queryKey: ['teslaOAuthStatus'],
    queryFn: () => api<TeslaOAuthStatus>('/tesla-oauth/status'),
    staleTime: 5 * 60_000,
    retry: false,
  });

  if (dismissed || !status || status.connected) return null;

  return (
    <div className="bg-[#141414] border border-[#3d2a1a] rounded-xl p-3 sm:p-4 mx-4 mt-3 mb-1 flex items-start gap-3">
      <div className="text-2xl shrink-0" aria-hidden="true">
        🚨
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="text-sm font-medium text-[#e0e0e0]">{t('securityAlerts.homeTeaser.title')}</div>
        <p className="text-xs text-[#9ca3af]">{t('securityAlerts.homeTeaser.body')}</p>
        <div className="flex flex-wrap gap-2 pt-1">
          <button
            className="bg-[#e31937] text-white px-3 py-1.5 rounded-lg text-xs font-medium active:bg-[#c0152f]"
            onClick={() => navigate('/settings')}
          >
            {t('securityAlerts.homeTeaser.cta')}
          </button>
          <button
            className="bg-transparent border border-[#2a2a2a] text-[#9ca3af] px-3 py-1.5 rounded-lg text-xs font-medium active:bg-[#1a1a1a]"
            onClick={() => {
              localStorage.setItem(DISMISS_KEY, '1');
              setDismissed(true);
            }}
          >
            {t('securityAlerts.homeTeaser.dismiss')}
          </button>
        </div>
      </div>
    </div>
  );
}
