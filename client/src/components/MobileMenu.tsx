import type { ReactNode } from 'react';
import type { SizeMode } from '../types';

export interface MobileMenuProps {
  /** Where you are standing, for the "add here" wording. */
  hereName: string;
  mode: SizeMode;
  modes: { id: SizeMode; label: string; title: string }[];
  onMode: (mode: SizeMode) => void;
  editing: boolean;
  onEditing: (on: boolean) => void;
  stats: { spaces: number; items: number; holdings: number; units: string };
  onDetails: () => void;
  onAdd: () => void;
  onTypes: () => void;
  onLabels: () => void;
  onSettings: () => void;
  onTour: () => void;
  onExport: () => void;
  onImport: (file: File) => void;
  onClose: () => void;
}

/**
 * Everything that lives in the desktop toolbar, folded into a sheet. A phone
 * toolbar has room for about five things, and navigation has to win — so
 * everything that is not navigation ends up in here.
 */
export function MobileMenu(props: MobileMenuProps) {
  const { stats } = props;
  return (
    <div className="m-scrim" onClick={props.onClose}>
      <div className="m-sheet" onClick={(e) => e.stopPropagation()} role="menu">
        <div className="sheet-grab" aria-hidden />

        <div className="m-group">
          <div className="m-group-title">Block size follows</div>
          <div className="segmented wide">
            {props.modes.map((m) => (
              <button
                key={m.id}
                className={props.mode === m.id ? 'on' : ''}
                onClick={() => {
                  props.onMode(m.id);
                  props.onClose();
                }}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        <label className="setting m-edit">
          <input
            type="checkbox"
            checked={props.editing}
            onChange={(e) => props.onEditing(e.target.checked)}
          />
          <span>
            <span className="s-label">Edit the layout</span>
            <span className="s-hint">
              Off, dragging does nothing and the map is only for looking at — which is what you
              want while you are hunting for an item. On, drag to draw, move and resize.
            </span>
          </span>
        </label>

        <div className="m-group">
          <Row icon="☰" label="Details" hint={`About ${props.hereName}`} onClick={fire(props.onDetails, props.onClose)} />
          <Row icon="+" label="Add inside" hint={`A new space in ${props.hereName}`} onClick={fire(props.onAdd, props.onClose)} />
          <Row icon="▦" label="Space types" hint="The templates new spaces start from" onClick={fire(props.onTypes, props.onClose)} />
          <Row icon="🏷" label="Labels" hint="Printer, stock size and defaults" onClick={fire(props.onLabels, props.onClose)} />
          <Row icon="⚙" label="Settings" onClick={fire(props.onSettings, props.onClose)} />
          <Row icon="?" label="How this works" onClick={fire(props.onTour, props.onClose)} />
        </div>

        <div className="m-group">
          <Row icon="↓" label="Back up" hint="Save everything to a .json file" onClick={fire(props.onExport, props.onClose)} />
          <label className="m-row" role="menuitem">
            <span className="m-icon">↑</span>
            <span className="m-text">
              <span className="m-label">Restore</span>
              <span className="m-hint">Replaces everything in the database</span>
            </span>
            <input
              type="file"
              accept="application/json"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) {
                  props.onImport(file);
                  props.onClose();
                }
              }}
            />
          </label>
        </div>

        <p className="m-stats">
          {stats.spaces} spaces · {stats.items} distinct items · {stats.holdings} holdings ·{' '}
          {stats.units} units
        </p>

        <button className="btn wide" onClick={props.onClose}>
          Close
        </button>
      </div>
    </div>
  );
}

const fire = (action: () => void, close: () => void) => () => {
  action();
  close();
};

function Row({
  icon,
  label,
  hint,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  hint?: string;
  onClick: () => void;
}) {
  return (
    <button className="m-row" onClick={onClick} role="menuitem">
      <span className="m-icon">{icon}</span>
      <span className="m-text">
        <span className="m-label">{label}</span>
        {hint && <span className="m-hint">{hint}</span>}
      </span>
    </button>
  );
}
