import { getCurrentWindow } from "@tauri-apps/api/window";
import type { ReactNode } from "react";
import { CloseIcon, MinusIcon } from "./icons";

export function TitleBar({ title, children }: { title?: string; children?: ReactNode }) {
  const win = getCurrentWindow();
  return (
    <header className="titlebar" data-tauri-drag-region>
      {title && (
        <span className="titlebar-title" data-tauri-drag-region>
          {title}
        </span>
      )}
      <div className="titlebar-actions">
        {children}
        <button className="icon-btn" title="Minimise" onClick={() => win.minimize()}>
          <MinusIcon />
        </button>
        <button className="icon-btn" title="Close (Esc)" onClick={() => win.close()}>
          <CloseIcon />
        </button>
      </div>
    </header>
  );
}
