import type { ReactNode } from 'react';

export interface PaneTab<T extends string> {
  id: T;
  name: ReactNode;
  /** A short line under the name: what's chosen in that pane. */
  note?: ReactNode;
  className?: string;
}

/**
 * Tabs for a menu that a phone shows one part at a time. A larger screen hides them and shows
 * every part at once (styles.css, "phones: the menus"), so each part marks itself with
 * `paneClass` and only the open one is shown on a phone.
 */
export function PaneTabs<T extends string>({ tabs, pane, onPane, label }: { tabs: PaneTab<NoInfer<T>>[]; pane: T; onPane(id: NoInfer<T>): void; label: string }) {
  return (
    <div className="pane-tabs" role="tablist" aria-label={label}>
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          className={`btn small pane-tab${pane === t.id ? ' on' : ''}${t.className ? ` ${t.className}` : ''}`}
          aria-selected={pane === t.id}
          data-pane-tab={t.id}
          onClick={() => onPane(t.id)}
        >
          <span className="pane-tab-name">{t.name}</span>
          {t.note !== undefined && <span className="pane-tab-note">{t.note}</span>}
        </button>
      ))}
    </div>
  );
}

/** The classes for one part of a tabbed menu: always `phone-pane`, and `pane-on` while it's the open one. */
export function paneClass<T extends string>(id: T, pane: T): string {
  return id === pane ? 'phone-pane pane-on' : 'phone-pane';
}
