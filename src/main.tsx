import { useEffect } from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useSettings } from "./api";
import { Deck } from "./views/Deck";
import { NoteWindow } from "./views/NoteWindow";
import { AllNotes } from "./views/AllNotes";
import { SettingsView } from "./views/SettingsView";
import "./styles.css";

const label = getCurrentWindow().label;
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
document.addEventListener("contextmenu", (e) => {
  const t = e.target as HTMLElement;
  if (!t.closest("input, textarea, [contenteditable=true]")) e.preventDefault();
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <Themed>
    <View />
  </Themed>,
);
