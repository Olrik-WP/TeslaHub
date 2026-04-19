import { useMemo, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

const cardClass = 'bg-[#0a0a0a] border border-[#2a2a2a] rounded-lg p-3 space-y-3';
const codeBlockClass =
  'bg-[#141414] border border-[#2a2a2a] rounded px-3 py-2 text-xs font-mono text-[#e0e0e0] break-all';
const linkClass = 'text-[#e31937] underline hover:text-[#ff4757]';
const buttonCopy =
  'bg-[#2a2a2a] text-white px-2 py-1 rounded text-[10px] uppercase tracking-wider active:bg-[#3a3a3a]';
const sectionTitleClass = 'text-xs text-[#9ca3af] uppercase tracking-wider';
const subTextClass = 'text-xs text-[#6b7280]';

function CopyableValue({ value }: { value: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  return (
    <div className="flex items-stretch gap-2">
      <div className={`flex-1 ${codeBlockClass}`}>{value}</div>
      <button
        className={buttonCopy}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            // Clipboard not allowed in some contexts; ignore.
          }
        }}
      >
        {copied ? t('securityAlerts.developerApp.copied') : t('securityAlerts.developerApp.copy')}
      </button>
    </div>
  );
}

/**
 * Inline tutorial for creating a Tesla developer app at developer.tesla.com.
 * Shown in Settings → Security Alerts when TESLA_CLIENT_ID is not yet
 * configured. The user can copy each value with one click to keep the
 * Tesla form filling error-free.
 */
export default function TeslaDeveloperAppGuide() {
  const { t } = useTranslation();

  const origin = useMemo(() => {
    if (typeof window === 'undefined') return 'https://teslahub.yourdomain.com';
    return window.location.origin;
  }, []);

  const redirectUri = useMemo(() => `${origin}/api/tesla-oauth/callback`, [origin]);

  const envSnippet = useMemo(
    () =>
      [
        'TESLA_CLIENT_ID=paste_your_client_id_here',
        'TESLA_CLIENT_SECRET=paste_your_client_secret_here',
        `TESLA_REDIRECT_URI=${redirectUri}`,
        '# Pick the audience matching your Tesla account region:',
        '#   EU:    https://fleet-api.prd.eu.vn.cloud.tesla.com   (default)',
        '#   NA/AP: https://fleet-api.prd.na.vn.cloud.tesla.com',
        'TESLA_AUDIENCE=https://fleet-api.prd.eu.vn.cloud.tesla.com',
        'SECURITY_ALERTS_ENABLED=true',
      ].join('\n'),
    [redirectUri],
  );

  return (
    <div className={cardClass}>
      <div>
        <div className={sectionTitleClass}>{t('securityAlerts.developerApp.title')}</div>
        <p className={subTextClass}>{t('securityAlerts.developerApp.intro')}</p>
      </div>

      <p className="text-xs text-[#e0e0e0]">
        <Trans
          i18nKey="securityAlerts.developerApp.step1"
          t={t}
          components={{
            link: (
              <a
                className={linkClass}
                href="https://developer.tesla.com"
                target="_blank"
                rel="noreferrer"
              >
                developer.tesla.com
              </a>
            ),
            b: <b className="text-white" />,
          }}
        />
      </p>

      <p className="text-xs text-[#e0e0e0]">
        <Trans i18nKey="securityAlerts.developerApp.step2" t={t} components={{ b: <b className="text-white" /> }} />
      </p>

      <p className="text-xs text-[#e0e0e0]">{t('securityAlerts.developerApp.step3')}</p>

      <div className="space-y-2">
        <div>
          <div className={sectionTitleClass}>{t('securityAlerts.developerApp.appNameLabel')}</div>
          <CopyableValue value={t('securityAlerts.developerApp.appNameValue')} />
        </div>
        <div>
          <div className={sectionTitleClass}>{t('securityAlerts.developerApp.descriptionLabel')}</div>
          <CopyableValue value={t('securityAlerts.developerApp.descriptionValue')} />
        </div>
        <div>
          <div className={sectionTitleClass}>{t('securityAlerts.developerApp.originLabel')}</div>
          <CopyableValue value={origin} />
        </div>
        <div>
          <div className={sectionTitleClass}>{t('securityAlerts.developerApp.redirectLabel')}</div>
          <CopyableValue value={redirectUri} />
        </div>
        <div>
          <div className={sectionTitleClass}>{t('securityAlerts.developerApp.scopesLabel')}</div>
          <CopyableValue value={t('securityAlerts.developerApp.scopesValue')} />
        </div>
      </div>

      <p className="text-xs text-[#e0e0e0]">
        <Trans i18nKey="securityAlerts.developerApp.step4" t={t} components={{ b: <b className="text-white" /> }} />
      </p>

      <div className="space-y-2">
        <p className="text-xs text-[#e0e0e0]">
          <Trans
            i18nKey="securityAlerts.developerApp.step5"
            t={t}
            components={{ code: <code className="text-[#e0e0e0] bg-[#141414] px-1 rounded" /> }}
          />
        </p>
        <CopyableValue value={envSnippet} />
        <p className={subTextClass}>
          <Trans
            i18nKey="securityAlerts.developerApp.envHint"
            t={t}
            components={{ code: <code className="text-[#e0e0e0] bg-[#141414] px-1 rounded" /> }}
          />
        </p>
      </div>
    </div>
  );
}
