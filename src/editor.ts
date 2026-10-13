import { Extension, wrappingInputRule } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import OrderedList from "@tiptap/extension-ordered-list";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";

/** Only "1. " starts a numbered list; a line starting "2024. " stays as typed. */
const StrictOrderedList = OrderedList.extend({
  addInputRules() {
    return [wrappingInputRule({ find: /^1\.\s$/, type: this.type })];
  },
});

/** Ctrl+Shift+L toggles a checklist, matching the bullet-list shortcut style. */
const ChecklistShortcut = Extension.create({
  name: "checklistShortcut",
  addKeyboardShortcuts() {
    return {
      "Mod-Shift-l": () => this.editor.commands.toggleTaskList(),
    };
  },
});

export const editorExtensions = [
  StarterKit.configure({ orderedList: false, heading: { levels: [1, 2, 3] } }),
  StrictOrderedList,
  TaskList,
  TaskItem.configure({ nested: true }),
  Link.configure({ openOnClick: false, autolink: true, linkOnPaste: true }),
  Placeholder.configure({ placeholder: "Write something…" }),
  ChecklistShortcut,
];
