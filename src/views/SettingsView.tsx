import { useEffect, useState } from "react";
import { api, useSettings, isMac, GLOBAL_MODS, MOD, type Settings } from "../api";
import { appVersion, autostartEnabled, setAutostart as applyAutostart } from "../platform";
import { useWin } from "../win";
import { TitleBar } from "../components/TitleBar";

function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} role="radio" aria-checked={value === v} onClick={() => onChange(v)}>
          {text}
        </button>
      ))}
    </div>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button role="switch" aria-checked={checked} aria-label={label} className="toggle" onClick={() => onChange(!checked)}>
      <span />
    </button>
  );
}

const Keys = ({ keys }: { keys: string[] }) => (
  <span className="keys">
    {keys.map((k) => (
      <kbd key={k}>{k}</kbd>
    ))}
  </span>
);

export function SettingsView() {
  const win = useWin();
  const settings = useSettings();
  const [autostart, setAutostart] = useState<boolean | null>(null);
  const [data, setData] = useState<{ path: string; portable: boolean } | null>(null);
  const [version, setVersion] = useState("");

  useEffect(() => {
    autostartEnabled().then(setAutostart).catch(() => setAutostart(false));
    api.dataInfo().then(setData);
    appVersion().then(setVersion);
  }, []);

  useEffect(() => {
    if (settings) win.show().then(() => win.setFocus());
  }, [settings !== null]);

  useEffect(() => {
    return win.onKey((e) => e.key === "Escape" && win.close());
  }, []);

  if (!settings) return null;
  const update = (patch: Partial<Settings>) => api.setSettings({ ...settings, ...patch });

  const toggleAutostart = async (on: boolean) => {
    try {
      setAutostart(await applyAutostart(on));
    } catch {
      setAutostart(await autostartEnabled().catch(() => false));
    }
  };

  return (
    <div className="window settings">
      <TitleBar title="Settings" />
      <div className="settings-body">
        <section>
          <h2>Deck</h2>
          <div className="row">
            <div>
              <div className="row-title">Screen edge</div>
              <div className="row-hint">Where the deck waits on your main display.</div>
            </div>
            <Segmented
              label="Screen edge"
              value={settings.edge}
              options={[
                ["left", "Left"],
                ["right", "Right"],
              ]}
              onChange={(edge) => update({ edge })}
            />
          </div>
          {!isMac && (
            <div className="row">
              <div>
                <div className="row-title">Hide during fullscreen</div>
                <div className="row-hint">Games, videos and presentations get the whole screen.</div>
              </div>
              <Toggle label="Hide during fullscreen" checked={settings.hideInFullscreen} onChange={(v) => update({ hideInFullscreen: v })} />
            </div>
          )}
        </section>

        <section>
          <h2>Appearance</h2>
          <div className="row">
            <div className="row-title">Theme</div>
            <Segmented
              label="Theme"
              value={settings.theme}
              options={[
                ["system", "System"],
                ["light", "Light"],
                ["dark", "Dark"],
              ]}
              onChange={(theme) => update({ theme })}
            />
          </div>
        </section>

        <section>
          <h2>System</h2>
          <div className="row">
            <div>
              <div className="row-title">Start at login</div>
              <div className="row-hint">Notes are ready as soon as your desktop is.</div>
            </div>
            <Toggle label="Start at login" checked={!!autostart} onChange={toggleAutostart} />
          </div>
        </section>

        <section>
          <h2>Shortcuts</h2>
          <div className="shortcut-grid">
            <span>New note</span>
            <Keys keys={[...GLOBAL_MODS, "N"]} />
            <span>All notes</span>
            <Keys keys={[...GLOBAL_MODS, "A"]} />
            <span>Archive</span>
            <Keys keys={[...GLOBAL_MODS, "L"]} />
            <span>Cycle colour</span>
            <Keys keys={[MOD, "."]} />
            <span>Delete (10s undo)</span>
            <Keys keys={[MOD, "⌫"]} />
            <span>Checklist</span>
            <Keys keys={[MOD, "Shift", "L"]} />
            <span>Link</span>
            <Keys keys={[MOD, "K"]} />
          </div>
          <p className="row-hint">Global shortcuts work from any app. If another app already uses one, EdgeNotes skips it.</p>
        </section>

        <section>
          <h2>Your data</h2>
          <p className="row-hint">
            Notes are stored only on this computer, in an ordinary file you can copy or back up. Nothing is uploaded.
          </p>
          {data && (
            <div className="data-path">
              <code>{data.path}</code>
              <button className="btn" onClick={() => api.revealData()}>
                Show file
              </button>
            </div>
          )}
          <p className="row-hint">
            {data?.portable
              ? "Portable mode is on: notes are kept next to the app."
              : "Portable mode: put an empty file named “portable” next to the app to keep notes beside it instead."}
          </p>
        </section>

        <footer className="settings-foot">
          <span>EdgeNotes {version}</span>
          <button className="btn danger" onClick={() => api.quit()}>
            Quit EdgeNotes
          </button>
        </footer>
      </div>
    </div>
  );
}
