import { createContext, useContext, type ReactNode } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

/** True inside the desktop app; false in the browser demo. */
export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** The window operations the views need, so they also run in the web demo. */
export type WinHandle = {
  label: string;
  show(): Promise<void>;
  setFocus(): Promise<void>;
  destroy(): Promise<void>;
  close(): Promise<void>;
  minimize(): Promise<void>;
  onCloseRequested(cb: (e: { preventDefault(): void }) => void | Promise<void>): Promise<() => void>;
  /** Keyboard events for this window only. */
  onKey(fn: (e: KeyboardEvent) => void, capture?: boolean): () => void;
};

let tauriHandle: WinHandle | null = null;

function getTauriHandle(): WinHandle {
  if (tauriHandle) return tauriHandle;
  const w = getCurrentWindow();
  tauriHandle = {
    label: w.label,
    show: () => w.show(),
    setFocus: () => w.setFocus(),
    destroy: () => w.destroy(),
    close: () => w.close(),
    minimize: () => w.minimize(),
    onCloseRequested: (cb) => w.onCloseRequested(cb),
    onKey: (fn, capture = false) => {
      window.addEventListener("keydown", fn, capture);
      return () => window.removeEventListener("keydown", fn, capture);
    },
  };
  return tauriHandle;
}

const WinContext = createContext<WinHandle | null>(null);

export function WinProvider({ handle, children }: { handle: WinHandle; children: ReactNode }) {
  return <WinContext.Provider value={handle}>{children}</WinContext.Provider>;
}

export function useWin(): WinHandle {
  return useContext(WinContext) ?? getTauriHandle();
}

export function currentLabel(): string {
  return getTauriHandle().label;
}
