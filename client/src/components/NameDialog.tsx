import { useEffect, useRef, useState } from 'react';

export interface NameDialogProps {
  title: string;
  /** Prefilled, and selected on open so typing replaces it. */
  value?: string;
  label?: string;
  confirm?: string;
  onSave: (name: string) => void;
  onClose: () => void;
}

/**
 * Asking for one name. `window.prompt` did this until it turned out that a
 * browser dialog is a different application interrupting yours — it lands in
 * the wrong typeface, in the wrong place, ignores the interface size, and on a
 * phone it takes over the screen.
 */
export function NameDialog({ title, value = '', label, confirm, onSave, onClose }: NameDialogProps) {
  const [name, setName] = useState(value);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  const save = () => {
    const trimmed = name.trim();
    if (trimmed) onSave(trimmed);
    onClose();
  };

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog narrow">
        <header>
          {title}
          <span className="spacer" />
          <button className="btn ghost" onClick={onClose}>✕</button>
        </header>

        <div className="body">
          <div className="field" style={{ marginBottom: 0 }}>
            {label && <label>{label}</label>}
            <input
              ref={input}
              value={name}
              autoCapitalize="words"
              autoCorrect="off"
              spellCheck={false}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                // Enter is the whole point of a one-field form.
                if (e.key === 'Enter') {
                  e.preventDefault();
                  save();
                }
                if (e.key === 'Escape') {
                  e.preventDefault();
                  onClose();
                }
              }}
            />
          </div>
        </div>

        <footer>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!name.trim()} onClick={save}>
            {confirm ?? 'Save'}
          </button>
        </footer>
      </div>
    </div>
  );
}
