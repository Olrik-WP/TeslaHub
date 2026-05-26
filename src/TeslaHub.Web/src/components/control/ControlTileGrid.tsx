import { useTranslation } from 'react-i18next';
import ControlTile from './ControlTile';
import { PANEL_IDS, type PanelId } from './controlPanels';

interface Props {
  /**
   * Called when a tile is tapped. The Control page lifts this into
   * the `?panel=` URL search param so the drawer opens. Decoupled
   * from URL manipulation here to keep this component pure UI.
   */
  onOpenPanel: (panel: PanelId) => void;
}

/**
 * Vertical list of the 6 Control surfaces, rendered as compact
 * status tiles. Each tile opens a focused drawer with the
 * corresponding existing Card content (ClimateCard, ChargeCard…).
 *
 * In PR-2 the subtitle and badge slots are empty placeholders. PR-3
 * will populate them from the live VehicleStatus snapshot.
 */
export default function ControlTileGrid({ onOpenPanel }: Props) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-2">
      {PANEL_IDS.map((panel) => (
        <ControlTile
          key={panel.id}
          icon={panel.icon}
          title={t(panel.titleKey)}
          // PR-3 fills these from VehicleStatus + snapshot.
          subtitle={undefined}
          badge={undefined}
          onClick={() => onOpenPanel(panel.id)}
        />
      ))}
    </div>
  );
}
