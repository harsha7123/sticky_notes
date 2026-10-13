// Thin wrappers over Tauri plugins with browser fallbacks for the web demo.
import { isTauri } from "./win";

export async function openExternal(url: string) {
  if (isTauri) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  } else {
    window.open(url, "_blank", "noopener");
  }
}

let demoAutostart = false;

export async function autostartEnabled(): Promise<boolean> {
  if (!isTauri) return demoAutostart;
  const { isEnabled } = await import("@tauri-apps/plugin-autostart");
  return isEnabled();
}

export async function setAutostart(on: boolean): Promise<boolean> {
  if (!isTauri) return (demoAutostart = on);
  const { enable, disable, isEnabled } = await import("@tauri-apps/plugin-autostart");
  await (on ? enable() : disable());
  return isEnabled();
}

export async function appVersion(): Promise<string> {
  if (!isTauri) return "0.1.0 · web demo";
  const { getVersion } = await import("@tauri-apps/api/app");
  return getVersion();
}

export async function pickSavePath(defaultPath: string, name: string, ext: string) {
  const { save } = await import("@tauri-apps/plugin-dialog");
  return save({ defaultPath, filters: [{ name, extensions: [ext] }] });
}

export async function pickOpenPath() {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const path = await open({ multiple: false, filters: [{ name: "Notes", extensions: ["json", "md", "txt"] }] });
  return typeof path === "string" ? path : null;
}
