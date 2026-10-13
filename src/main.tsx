import { useEffect } from "react";
import ReactDOM from "react-dom/client";
import { useSettings } from "./api";
import { currentLabel, isTauri } from "./win";
import { Deck } from "./views/Deck";
import { NoteWindow } from "./views/NoteWindow";
import { AllNotes } from "./views/AllNotes";
import { SettingsView } from "./views/SettingsView";
import { DemoDesktop } from "./demo/DemoDesktop";
import "./styles.css";

// In the desktop app each window loads this page; its label picks the view.
// In a plain browser, the whole app runs as a simulated desktop instead.
const label = isTauri ? currentLabel() : "demo";
const kind = label.startsWith("note-") ? "note" : label;
document.body.dataset.view = kind;

/** Follows the theme setting; "system" defers to the OS via CSS. */
function Themed({ children }: { children: React.ReactNode }) {
  const settings = useSettings();
  useEffect(() => {
    const root = document.documentElement;
    if (!settings || settings.theme === "system") delete root.dataset.theme;
    else root.dataset.theme = settings.theme;
  }, [settings?.theme]);
  return <>{children}</>;
}

function View() {
  switch (kind) {
    case "demo":
      return <DemoDesktop />;
    case "deck":
      return <Deck />;
    case "note":
      return <NoteWindow id={label.slice("note-".length)} />;
    case "all":
      return <AllNotes />;
    default:
      return <SettingsView />;
  }
}

// Plain context menus don't belong in a native-feeling app (editor fields keep theirs).
if (isTauri) {
  document.addEventListener("contextmenu", (e) => {
    const t = e.target as HTMLElement;
    if (!t.closest("input, textarea, [contenteditable=true]")) e.preventDefault();
  });
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <Themed>
    <View />
  </Themed>,
);
