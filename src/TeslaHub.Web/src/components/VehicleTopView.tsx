import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUnits } from '../hooks/useUnits';
import type { VehicleStatus } from '../api/queries';

const MQTT_HINT_KEY = 'teslahub:mqtt-hint-dismissed';

interface Props {
  vehicle: VehicleStatus;
}

const TIRE_POSITIONS = [
  { key: 'fl', labelKey: 'vehicleView.tireFL', x: 70, y: 100 },
  { key: 'fr', labelKey: 'vehicleView.tireFR', x: 230, y: 100 },
  { key: 'rl', labelKey: 'vehicleView.tireRL', x: 62, y: 340 },
  { key: 'rr', labelKey: 'vehicleView.tireRR', x: 238, y: 340 },
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

  const hasTpmsPressure = vehicle.tpmsPressureFl != null;
  const hasTpmsWarning = vehicle.tpmsSoftWarningFl != null;
  const hasTpms = hasTpmsPressure || hasTpmsWarning;
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
            <svg viewBox="0 0 300 470" className="w-[220px] sm:w-[260px]" xmlns="http://www.w3.org/2000/svg">
              {/* Vehicle body — Tesla Model 3/Y silhouette */}
              <path
                d="M150 18 C118 18 102 30 93 50 L82 78 C78 90 73 115 70 135 L66 175 L63 215 L63 295 L66 340 L70 365 C73 385 80 400 90 410 L100 418 C112 425 130 430 150 430 C170 430 188 425 200 418 L210 410 C220 400 227 385 230 365 L234 340 L237 295 L237 215 L234 175 L230 135 C227 115 222 90 218 78 L207 50 C198 30 182 18 150 18Z"
                fill="#1e1e1e" stroke="#3a3a3a" strokeWidth="2"
              />
              {/* Front bumper sculpt */}
              <path d="M105 38 C120 30 140 26 150 26 C160 26 180 30 195 38" fill="none" stroke="#2a2a2a" strokeWidth="1" />
              {/* Headlight DRL strips */}
              <path d="M88 58 C100 48 125 42 150 42 C175 42 200 48 212 58" fill="none" stroke="#555" strokeWidth="2.5" strokeLinecap="round" />
              {/* Taillight bar */}
              <path d="M95 414 C115 422 135 426 150 426 C165 426 185 422 205 414" fill="none" stroke="#ef4444" strokeWidth="2.5" strokeLinecap="round" opacity="0.6" />
              {/* Side mirrors — mid-door level, well below front tires */}
              <ellipse cx="61" cy="152" rx="7" ry="4" fill="#252525" stroke="#3a3a3a" strokeWidth="1" />
              <ellipse cx="239" cy="152" rx="7" ry="4" fill="#252525" stroke="#3a3a3a" strokeWidth="1" />
              {/* Glass roof — windshield + roof + rear window as one piece */}
              <path
                d="M108 80 L192 80 L206 128 L210 160 L210 320 L206 355 L192 385 L108 385 L94 355 L90 320 L90 160 L94 128Z"
                fill="#181818" stroke="#333" strokeWidth="1"
              />
              {/* Windshield separator */}
              <line x1="94" y1="128" x2="206" y2="128" stroke="#2a2a2a" strokeWidth="1" />
              {/* Rear window separator */}
              <line x1="94" y1="348" x2="206" y2="348" stroke="#2a2a2a" strokeWidth="1" />
              {/* Roof panel */}
              <rect x="92" y="138" width="116" height="200" rx="6" fill="#1a1a1a" stroke="#2a2a2a" strokeWidth="0.5" />

              {/* Tires — always visible; colored when TPMS data is available */}
              {TIRE_POSITIONS.map((tp) => {
                const warn = hasTpms ? getWarning(vehicle, tp.key) : false;
                const pressure = hasTpmsPressure ? getPressure(vehicle, tp.key) : null;
                const color = warn ? '#ef4444' : pressure != null ? '#22c55e' : '#444';
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
                    {pressure == null && warn && (
                      <text
                        x={tp.x} y={tp.y + 5}
                        textAnchor="middle" fill="#ef4444"
                        fontSize="18" fontWeight="bold"
                      >
                        ⚠
                      </text>
                    )}
                  </g>
                );
              })}

              {/* Door indicators — per-door if available, otherwise generic */}
              {vehicle.driverFrontDoorOpen != null ? (
                <>
                  {vehicle.driverFrontDoorOpen && <line x1="60" y1="165" x2="40" y2="180" stroke="#f59e0b" strokeWidth="3" strokeLinecap="round" />}
                  {vehicle.driverRearDoorOpen && <line x1="60" y1="250" x2="40" y2="265" stroke="#f59e0b" strokeWidth="3" strokeLinecap="round" />}
                  {vehicle.passengerFrontDoorOpen && <line x1="240" y1="165" x2="260" y2="180" stroke="#f59e0b" strokeWidth="3" strokeLinecap="round" />}
                  {vehicle.passengerRearDoorOpen && <line x1="240" y1="250" x2="260" y2="265" stroke="#f59e0b" strokeWidth="3" strokeLinecap="round" />}
                </>
              ) : vehicle.doorsOpen === true && (
                <>
                  <line x1="60" y1="170" x2="40" y2="190" stroke="#f59e0b" strokeWidth="3" strokeLinecap="round" />
                  <line x1="240" y1="170" x2="260" y2="190" stroke="#f59e0b" strokeWidth="3" strokeLinecap="round" />
                </>
              )}

              {/* Charge port flap — starts AT the body edge, opens outward */}
              {vehicle.chargePortDoorOpen === true && (
                <path d="M80 390 L62 398" fill="none" stroke="#f59e0b" strokeWidth="3" strokeLinecap="round" />
              )}

              {/* Plugged in / charging — cable from body, to the right of the flap */}
              {(vehicle.pluggedIn === true || isCharging) && (
                <g>
                  {/* Cable — neon green, wide sweeping arc from body to station */}
                  <path d="M83 396 C50 400 15 435 28 466" fill="none" stroke="#39ff14" strokeWidth="3" strokeLinecap="round" />
                  {/* Charging station (borne) — blue, centered on cable end */}
                  <rect x="19" y="466" width="18" height="12" rx="3" fill="#3b82f6" />
                  <rect x="24" y="461" width="8" height="5" rx="1.5" fill="#3b82f6" />
                  {/* Lightning bolt — electric yellow, well to the right of the cable */}
                  <g transform="translate(72, 436)">
                    <path d="M-2 -10 L-6 2 L-1 0 L2 10 L6 -2 L1 0Z" fill={isCharging ? '#facc15' : '#6b7280'} />
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
                  <line x1="60" y1="220" x2="42" y2="220" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" />
                  <line x1="240" y1="220" x2="258" y2="220" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" />
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

              {/* Pressure unit label — only when actual pressure values exist */}
              {hasTpmsPressure && (
                <text x="150" y="450" textAnchor="middle" fill="#6b7280" fontSize="10">
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

          {/* TPMS — direct (pressures) or indirect (warnings only) */}
          {hasTpms && (
            <div className="bg-[#0a0a0a] border border-[#2a2a2a] rounded-lg p-3">
              <div className="text-xs text-[#9ca3af] uppercase tracking-wider mb-2">
                {t('vehicleView.tirePressure')}
                {!hasTpmsPressure && <span className="text-[10px] normal-case ml-1">({t('vehicleView.tpmsIndirect')})</span>}
              </div>
              {hasTpmsPressure ? (
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
              ) : (
                <div className="flex flex-wrap gap-2">
                  {TIRE_POSITIONS.map((tp) => {
                    const warn = getWarning(vehicle, tp.key);
                    return (
                      <StatusPill
                        key={tp.key}
                        label={t(tp.labelKey)}
                        active={warn}
                        color={warn ? '#ef4444' : '#22c55e'}
                        text={warn ? t('vehicleView.lowPressure') : 'OK'}
                      />
                    );
                  })}
                </div>
              )}
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
