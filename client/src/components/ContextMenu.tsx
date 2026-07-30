import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export interface MenuItem {
  label: string;
  danger?: boolean;
  onPick: () => void;
}

export interface ContextMenuProps {
  x: number;
  y: number;
  title: string;
  items: MenuItem[];
  onClose: () => void;
}

/** A right-click menu, kept inside the window and dismissed by anything else. */
export function ContextMenu({ x, y, title, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const pad = 6;
    setAt({
      left: Math.max(pad, Math.min(x, window.innerWidth - el.offsetWidth - pad)),
      top: Math.max(pad, Math.min(y, window.innerHeight - el.offsetHeight - pad)),
    });
  }, [x, y]);

  useEffect(() => {
    const dismiss = () => onClose();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    // `capture` so the menu closes before whatever was clicked reacts.
    window.addEventListener('pointerdown', dismiss, true);
    window.addEventListener('blur', dismiss);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', dismiss, true);
      window.removeEventListener('blur', dismiss);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div ref={ref} className="context-menu" style={{ left: at.left, top: at.top }}>
      <div className="cm-title">{title}</div>
      {items.map((item) => (
        <button
          key={item.label}
          className={item.danger ? 'cm-item danger' : 'cm-item'}
          onClick={() => {
            onClose();
            item.onPick();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
