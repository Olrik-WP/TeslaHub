export interface PaintOption {
  code: string;
  name: string;
  hex: string;
}

export interface WheelOption {
  code: string;
  name: string;
}

export const PAINT_OPTIONS: PaintOption[] = [
  { code: 'PPSW', name: 'Pearl White', hex: '#f2f2f2' },
  { code: 'PBSB', name: 'Solid Black', hex: '#1a1a1a' },
  { code: 'PMNG', name: 'Midnight Silver', hex: '#42464a' },
  { code: 'PPSB', name: 'Deep Blue', hex: '#1e3a5f' },
  { code: 'PPMR', name: 'Red Multi-Coat', hex: '#a81e22' },
  { code: 'PMSS', name: 'Silver Metallic', hex: '#c0c0c0' },
  { code: 'PN01', name: 'Ultra White', hex: '#f5f5f5' },
  { code: 'PR01', name: 'Ultra Red', hex: '#c41e3a' },
  { code: 'PR00', name: 'Midnight Cherry', hex: '#3d0c11' },
  { code: 'PMSG', name: 'Stealth Grey', hex: '#5a5a5a' },
  { code: 'PMAB', name: 'Glacier Blue', hex: '#7ba7c9' },
];

const WHEELS_BY_MODEL: Record<string, WheelOption[]> = {
  m3: [
    { code: 'W38B', name: 'Aero 18"' },
    { code: 'W39B', name: 'Sport 19"' },
    { code: 'W32B', name: 'Performance 20"' },
    { code: 'W38A', name: 'Photon 18" (Highland)' },
    { code: 'W40B', name: 'Nova 19" (Highland)' },
  ],
  my: [
    { code: 'WY19B', name: 'Gemini 19"' },
    { code: 'WY20P', name: 'Induction 20"' },
  ],
  ms: [
    { code: 'WS10', name: 'Tempest 19"' },
    { code: 'WS90', name: 'Arachnid 21"' },
  ],
  mx: [
    { code: 'WX00', name: 'Cyberstream 20"' },
    { code: 'WX20', name: 'Turbine 22"' },
  ],
};

const MODEL_MAP: Record<string, string> = {
  S: 'ms', '3': 'm3', X: 'mx', Y: 'my',
  'Model S': 'ms', 'Model 3': 'm3', 'Model X': 'mx', 'Model Y': 'my',
};

export function getModelCode(model: string | null | undefined): string {
  if (!model) return 'm3';
  return MODEL_MAP[model] ?? 'm3';
}

export function getWheelsForModel(modelCode: string): WheelOption[] {
  return WHEELS_BY_MODEL[modelCode] ?? WHEELS_BY_MODEL.m3;
}

export const HIGHLAND_M3_WHEELS = new Set(['W38A', 'W40B']);

export interface VariantOption {
  code: string;
  name: string;
}

export const HIGHLAND_M3_VARIANTS: VariantOption[] = [
  { code: 'MT336', name: 'Propulsion (RWD)' },
  { code: 'MT337', name: 'Long Range (AWD)' },
  { code: 'MT338', name: 'Performance (AWD)' },
];

export function isHighlandWheel(modelCode: string, wheelCode: string): boolean {
  return modelCode === 'm3' && HIGHLAND_M3_WHEELS.has(wheelCode);
}

export function buildCompositorUrl(
  modelCode: string,
  paintCode: string,
  wheelCode: string,
  variantCode?: string
): string {
  let opts = `$${paintCode},$${wheelCode}`;

  if (modelCode === 'm3' && HIGHLAND_M3_WHEELS.has(wheelCode)) {
    const variant = variantCode || 'MT336';
    opts = `$${variant},$${paintCode},$${wheelCode}`;
  }

  return `https://static-assets.tesla.com/configurator/compositor?model=${modelCode}&view=STUD_3QTR&size=800&options=${opts}&bkba_opt=1`;
}
