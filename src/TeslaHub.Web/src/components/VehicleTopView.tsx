import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUnits } from '../hooks/useUnits';
import type { VehicleStatus } from '../api/queries';

const MQTT_HINT_KEY = 'teslahub:mqtt-hint-dismissed';

interface Props {
  vehicle: VehicleStatus;
}

const TIRE_POSITIONS = [
  { key: 'fl', labelKey: 'vehicleView.tireFL', x: 72, y: 72 },
  { key: 'fr', labelKey: 'vehicleView.tireFR', x: 228, y: 72 },
  { key: 'rl', labelKey: 'vehicleView.tireRL', x: 72, y: 328 },
  { key: 'rr', labelKey: 'vehicleView.tireRR', x: 228, y: 328 },
] as const;

type TireKey = 'fl' | 'fr' | 'rl' | 'rr';

function getPressure(v: VehicleStatus, k: TireKey) {
  const map = { fl: v.tpmsPressureFl, fr: v.tpmsPressureFr, rl: v.tpmsPressureRl, rr: v.tpmsPressureRr };
  return map[k];
}

function getWarning(v: VehicleStatus, k: TireKey) {
  const map = { fl: v.tpmsSoftWarningFl, fr: v.tpmsSoftWarningFr, rl: v.tpmsSoftWarningRl, rr: v.tpmsSoftWarningRr };
  return map[k] === true;
}

export default function VehicleTopView({ vehicle }: Props) {
  const { t } = useTranslation();
  const u = useUnits();
  const [hintDismissed, setHintDismissed] = useState(() => localStorage.getItem(MQTT_HINT_KEY) === '1');

  const hasTpms = vehicle.tpmsPressureFl != null;
  const hasBody = vehicle.doorsOpen != null || vehicle.trunkOpen != null || vehicle.isLocked != null;
  const hasClimate = vehicle.isClimateOn != null || vehicle.driverTempSetting != null;
  const isCharging = vehicle.state?.toLowerCase() === 'charging';
  const hasChargePort = vehicle.chargePortDoorOpen != null || vehicle.pluggedIn != null;

  if (!hasTpms && !hasBody && !hasClimate && !isCharging && !hasChargePort) return null;

  const dismissHint = () => {
    localStorage.setItem(MQTT_HINT_KEY, '1');
    setHintDismissed(true);
  };

  const showMqttBanner = !vehicle.mqttConnected && !hintDismissed;

  return (
    <div className="bg-[#141414] border border-[#2a2a2a] rounded-xl p-3 sm:p-4">
      {showMqttBanner && (
        <div className="text-[10px] text-[#6b7280] mb-2 flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-[#6b7280] inline-block" />
          <span className="flex-1">{hasBody ? t('vehicleView.mqttDisconnected') : t('vehicleView.mqttHint')}</span>
          <button onClick={dismissHint} className="text-[#6b7280] hover:text-[#9ca3af] ml-1 px-1 leading-none" aria-label="Dismiss">✕</button>
        </div>
      )}

      <div className="flex flex-col lg:flex-row gap-4">
        {/* SVG vehicle top-down view — only when there is visual data to display */}
        {(hasTpms || hasBody || isCharging || hasChargePort) && (
          <div className="flex-shrink-0 flex justify-center">
            <svg viewBox="0 0 300 440" className="w-[220px] sm:w-[260px]" xmlns="http://www.w3.org/2000/svg">
              {/* Vehicle body outline */}
              <path
                d="M150 20 C100 20 80 50 75 80 L65 160 L60 200 L60 300 L65 360 C70 400 100 420 150 420 C200 420 230 400 235 360 L240 300 L240 200 L235 160 L225 80 C220 50 200 20 150 20Z"
                fill="#1a1a1a" stroke="#3a3a3a" strokeWidth="2"
              />
              {/* Windshield */}
              <path d="M100 85 L200 85 L210 140 L90 140Z" fill="#222" stroke="#3a3a3a" strokeWidth="1" />
              {/* Rear window */}
              <path d="M100 370 L200 370 L210 330 L90 330Z" fill="#222" stroke="#3a3a3a" strokeWidth="1" />
              {/* Roof */}
              <rect x="88" y="150" width="124" height="170" rx="8" fill="#1e1e1e" stroke="#333" strokeWidth="1" />

              {/* Tires — only rendered when TPMS data exists */}
              {hasTpms && TIRE_POSITIONS.map((tp) => {
                const warn = getWarning(vehicle, tp.key);
                const pressure = getPressure(vehicle, tp.key);
                const color = warn ? '#ef4444' : pressure != null ? '#22c55e' : '#555';
                return (
                  <g key={tp.key}>
                    <rect
                      x={tp.x - 14} y={tp.y - 28} width="28" height="56" rx="6"
                      fill={color + '30'} stroke={color} strokeWidth="2"
                    />
                    {pressure != null && (
                      <text
                        x={tp.x} y={tp.y + 42}
                        textAnchor="middle" fill={warn ? '#ef4444' : '#d1d5db'}
                        fontSize="11" fontWeight="bold" fontFamily="monospace"
                      >
                        {u.fmtPressure(pressure)}
                      </text>
                    )}
                  </g>
                );
              })}

              {/* Door indicators — per-door if available, otherwise generic */}
              {vehicle.driverFrontDoorOpen != null ? (
                <>
                  {vehicle.driverFrontDoorOpen && <line x1="58" y1="165" x2="38" y2="180" stroke="#f59e0b" strokeWidth="3" strokeLinecap="round" />}
                  {vehicle.driverRearDoorOpen && <line x1="58" y1="230" x2="38" y2="245" stroke="#f59e0b" strokeWidth="3" strokeLinecap="round" />}
                  {vehicle.passengerFrontDoorOpen && <line x1="242" y1="165" x2="262" y2="180" stroke="#f59e0b" strokeWidth="3" strokeLinecap="round" />}
                  {vehicle.passengerRearDoorOpen && <line x1="242" y1="230" x2="262" y2="245" stroke="#f59e0b" strokeWidth="3" strokeLinecap="round" />}
                </>
              ) : vehicle.doorsOpen === true && (
                <>
                  <line x1="58" y1="170" x2="40" y2="190" stroke="#f59e0b" strokeWidth="3" strokeLinecap="round" />
                  <line x1="242" y1="170" x2="260" y2="190" stroke="#f59e0b" strokeWidth="3" strokeLinecap="round" />
                </>
              )}

              {/* Charge port flap — on left body between rear window and RL tire */}
              {vehicle.chargePortDoorOpen === true && (
                <path d="M60 295 L42 305" fill="none" stroke="#f59e0b" strokeWidth="3" strokeLinecap="round" />
              )}

              {/* Plugged in / charging — cable + bolt */}
              {(vehicle.pluggedIn === true || isCharging) && (
                <g>
                  <path d="M42 305 Q30 315 22 330 Q16 345 18 360" fill="none" stroke="#3b82f6" strokeWidth="3" strokeLinecap="round" />
                  <rect x="13" y="360" width="10" height="6" rx="2" fill="#3b82f6" />
                  <g transform="translate(15, 340)">
                    <path d="M-1 -7 L-4 1 L-1 0 L1 7 L4 -1 L1 0Z" fill={isCharging ? '#3b82f6' : '#6b7280'} />
                  </g>
                </g>
              )}

              {/* Frunk indicator */}
              {vehicle.frunkOpen === true && (
                <path d="M120 50 L150 30 L180 50" fill="none" stroke="#f59e0b" strokeWidth="3" strokeLinecap="round" />
              )}

              {/* Trunk indicator */}
              {vehicle.trunkOpen === true && (
                <path d="M120 395 L150 415 L180 395" fill="none" stroke="#f59e0b" strokeWidth="3" strokeLinecap="round" />
              )}

              {/* Windows indicator */}
              {vehicle.windowsOpen === true && (
                <>
                  <line x1="56" y1="220" x2="42" y2="220" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" />
                  <line x1="244" y1="220" x2="258" y2="220" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" />
                </>
              )}

              {/* Lock icon */}
              <g transform="translate(150, 210)">
                {vehicle.isLocked === true && (
                  <>
                    <rect x="-8" y="-2" width="16" height="12" rx="2" fill="#22c55e" />
                    <path d="M-5 -2 L-5 -7 A5 5 0 0 1 5 -7 L5 -2" fill="none" stroke="#22c55e" strokeWidth="2" />
                  </>
                )}
                {vehicle.isLocked === false && (
                  <>
                    <rect x="-8" y="-2" width="16" height="12" rx="2" fill="#ef4444" />
                    <path d="M-5 -2 L-5 -7 A5 5 0 0 1 5 -7 L5 -7" fill="none" stroke="#ef4444" strokeWidth="2" />
                  </>
                )}
              </g>

              {/* Sentry mode eye */}
              {vehicle.sentryMode != null && (
                <g transform="translate(150, 245)">
                  {/* Outer gray ring */}
                  <circle r="12" fill="none" stroke="#6b7280" strokeWidth="2" />
                  {/* Inner fill — red when active, dark when inactive */}
                  <circle r="9" fill={vehicle.sentryMode ? '#ef4444' : '#1a1a1a'} />
                  {/* Eye shape */}
                  <ellipse rx="7" ry="4" fill="none" stroke={vehicle.sentryMode ? '#fff' : '#6b7280'} strokeWidth="1.5" />
                  {/* Pupil */}
                  <circle r="2" fill={vehicle.sentryMode ? '#fff' : '#6b7280'} />
                </g>
              )}

              {/* User present indicator */}
              {vehicle.isUserPresent != null && (
                <g transform="translate(150, 280)">
                  <circle r="12" fill="none" stroke="#6b7280" strokeWidth="2" />
                  <circle r="9" fill={vehicle.isUserPresent ? '#22c55e' : '#1a1a1a'} />
                  {/* Head */}
                  <circle cy="-2.5" r="2.5" fill={vehicle.isUserPresent ? '#fff' : '#6b7280'} />
                  {/* Body */}
                  <path d="M-4 3 Q-4 0.5 0 0.5 Q4 0.5 4 3 L3.5 7 L-3.5 7Z"
                    fill={vehicle.isUserPresent ? '#fff' : '#6b7280'} />
                </g>
              )}

              {/* Climate indicator */}
              {vehicle.isClimateOn === true && (
                <g transform="translate(150, 180)">
                  <text textAnchor="middle" fill="#22c55e" fontSize="16">❄</text>
                </g>
              )}

              {/* Pressure unit label */}
              {hasTpms && (
                <text x="150" y="435" textAnchor="middle" fill="#6b7280" fontSize="10">
                  {u.pressureUnit}
                </text>
              )}
            </svg>
          </div>
        )}

        {/* Info panels */}
        <div className="flex-1 space-y-3 min-w-0">
          {/* Body / Security */}
          {hasBody && (
            <div className="bg-[#0a0a0a] border border-[#2a2a2a] rounded-lg p-3">
              <div className="text-xs text-[#9ca3af] uppercase tracking-wider mb-2 flex items-center gap-1.5">
                {t('vehicleView.security')}
                {vehicle.mqttConnected && <span className="w-1.5 h-1.5 rounded-full bg-[#22c55e] inline-block" title="MQTT live" />}
              </div>
              <div className="flex flex-wrap gap-2">
                <StatusPill
                  label={t('vehicleView.locked')}
                  active={vehicle.isLocked === true}
                  color={vehicle.isLocked === true ? '#22c55e' : vehicle.isLocked === false ? '#ef4444' : undefined}
                  text={vehicle.isLocked === true ? t('vehicleView.yes') : vehicle.isLocked === false ? t('vehicleView.no') : '—'}
                />
                {vehicle.driverFrontDoorOpen != null ? (
                  <>
                    <StatusPill label={t('vehicleView.doorDF')} active={vehicle.driverFrontDoorOpen === true}
                      color={vehicle.driverFrontDoorOpen ? '#f59e0b' : '#22c55e'}
                      text={vehicle.driverFrontDoorOpen ? t('vehicleView.open') : t('vehicleView.closed')} />
                    <StatusPill label={t('vehicleView.doorDR')} active={vehicle.driverRearDoorOpen === true}
                      color={vehicle.driverRearDoorOpen ? '#f59e0b' : '#22c55e'}
                      text={vehicle.driverRearDoorOpen ? t('vehicleView.open') : t('vehicleView.closed')} />
                    <StatusPill label={t('vehicleView.doorPF')} active={vehicle.passengerFrontDoorOpen === true}
                      color={vehicle.passengerFrontDoorOpen ? '#f59e0b' : '#22c55e'}
                      text={vehicle.passengerFrontDoorOpen ? t('vehicleView.open') : t('vehicleView.closed')} />
                    <StatusPill label={t('vehicleView.doorPR')} active={vehicle.passengerRearDoorOpen === true}
                      color={vehicle.passengerRearDoorOpen ? '#f59e0b' : '#22c55e'}
                      text={vehicle.passengerRearDoorOpen ? t('vehicleView.open') : t('vehicleView.closed')} />
                  </>
                ) : (
                  <StatusPill label={t('vehicleView.doors')} active={vehicle.doorsOpen === true}
                    color={vehicle.doorsOpen ? '#f59e0b' : '#22c55e'}
                    text={vehicle.doorsOpen ? t('vehicleView.open') : t('vehicleView.closed')} />
                )}
                <StatusPill
                  label={t('vehicleView.frunk')}
                  active={vehicle.frunkOpen === true}
                  color={vehicle.frunkOpen ? '#f59e0b' : '#22c55e'}
                  text={vehicle.frunkOpen ? t('vehicleView.open') : t('vehicleView.closed')}
                />
                <StatusPill
                  label={t('vehicleView.trunk')}
                  active={vehicle.trunkOpen === true}
                  color={vehicle.trunkOpen ? '#f59e0b' : '#22c55e'}
                  text={vehicle.trunkOpen ? t('vehicleView.open') : t('vehicleView.closed')}
                />
                <StatusPill
                  label={t('vehicleView.windows')}
                  active={vehicle.windowsOpen === true}
                  color={vehicle.windowsOpen ? '#3b82f6' : '#22c55e'}
                  text={vehicle.windowsOpen ? t('vehicleView.open') : t('vehicleView.closed')}
                />
                {vehicle.chargePortDoorOpen != null && (
                  <StatusPill
                    label={t('vehicleView.chargePort')}
                    active={vehicle.chargePortDoorOpen === true}
                    color={vehicle.chargePortDoorOpen ? '#f59e0b' : '#22c55e'}
                    text={vehicle.chargePortDoorOpen ? t('vehicleView.open') : t('vehicleView.closed')}
                  />
                )}
                {vehicle.pluggedIn != null && (
                  <StatusPill
                    label={t('vehicleView.pluggedIn')}
                    active={vehicle.pluggedIn === true}
                    color={vehicle.pluggedIn ? '#3b82f6' : '#6b7280'}
                    text={vehicle.pluggedIn ? t('vehicleView.yes') : t('vehicleView.no')}
                  />
                )}
                {vehicle.sentryMode != null && (
                  <StatusPill
                    label={t('vehicleView.sentry')}
                    active={vehicle.sentryMode === true}
                    color={vehicle.sentryMode ? '#3b82f6' : '#6b7280'}
                    text={vehicle.sentryMode ? t('vehicleView.on') : t('vehicleView.off')}
                  />
                )}
                {vehicle.isUserPresent != null && (
                  <StatusPill
                    label={t('vehicleView.userPresent')}
                    active={vehicle.isUserPresent === true}
                    color={vehicle.isUserPresent ? '#22c55e' : '#6b7280'}
                    text={vehicle.isUserPresent ? t('vehicleView.yes') : t('vehicleView.no')}
                  />
                )}
              </div>
            </div>
          )}

          {/* Climate */}
          {hasClimate && (
            <div className="bg-[#0a0a0a] border border-[#2a2a2a] rounded-lg p-3">
              <div className="text-xs text-[#9ca3af] uppercase tracking-wider mb-2">{t('vehicleView.climate')}</div>
              <div className="flex flex-wrap gap-2">
                <StatusPill
                  label={t('vehicleView.climateOn')}
                  active={vehicle.isClimateOn === true}
                  color={vehicle.isClimateOn ? '#22c55e' : '#6b7280'}
                  text={vehicle.isClimateOn ? t('vehicleView.on') : t('vehicleView.off')}
                />
                {vehicle.driverTempSetting != null && (
                  <StatusPill
                    label={t('vehicleView.driverTemp')}
                    active={false}
                    text={`${u.fmtTemp(vehicle.driverTempSetting)}${u.tempUnit}`}
                  />
                )}
                {vehicle.passengerTempSetting != null && (
                  <StatusPill
                    label={t('vehicleView.passengerTemp')}
                    active={false}
                    text={`${u.fmtTemp(vehicle.passengerTempSetting)}${u.tempUnit}`}
                  />
                )}
                {vehicle.climateKeeperMode != null && vehicle.climateKeeperMode !== 'off' && (
                  <StatusPill
                    label={t('vehicleView.keeper')}
                    active
                    color="#3b82f6"
                    text={vehicle.climateKeeperMode}
                  />
                )}
                {vehicle.isPreconditioning === true && (
                  <StatusPill label={t('vehicleView.preconditioning')} active color="#f59e0b" text={t('vehicleView.on')} />
                )}
                {vehicle.isFrontDefrosterOn === true && (
                  <StatusPill label={t('vehicleView.frontDefroster')} active color="#3b82f6" text={t('vehicleView.on')} />
                )}
                {vehicle.isRearDefrosterOn === true && (
                  <StatusPill label={t('vehicleView.rearDefroster')} active color="#3b82f6" text={t('vehicleView.on')} />
                )}
              </div>
            </div>
          )}

          {/* TPMS */}
          {hasTpms && (
            <div className="bg-[#0a0a0a] border border-[#2a2a2a] rounded-lg p-3">
              <div className="text-xs text-[#9ca3af] uppercase tracking-wider mb-2">{t('vehicleView.tirePressure')}</div>
              <div className="grid grid-cols-2 gap-2">
                {TIRE_POSITIONS.map((tp) => {
                  const p = getPressure(vehicle, tp.key);
                  const warn = getWarning(vehicle, tp.key);
                  return (
                    <div key={tp.key} className="flex items-center gap-2">
                      <span className="text-xs text-[#9ca3af] w-8">{t(tp.labelKey)}</span>
                      <span className={`text-sm font-mono font-bold ${warn ? 'text-[#ef4444]' : 'text-white'}`}>
                        {u.fmtPressure(p)} {u.pressureUnit}
                      </span>
                      {warn && <span className="text-[#ef4444] text-xs">⚠</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusPill({ label, active, color, text }: {
  label: string;
  active: boolean;
  color?: string;
  text: string;
}) {
  return (
    <div className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs ${active ? 'bg-[#1a1a1a]' : 'bg-[#111]'}`}>
      {color && <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />}
      <span className="text-[#9ca3af]">{label}:</span>
      <span className="text-white font-medium">{text}</span>
    </div>
  );
}
