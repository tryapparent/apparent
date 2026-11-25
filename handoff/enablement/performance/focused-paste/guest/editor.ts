type TextBuffer = {
  connect(signal: "changed", callback: () => void): void;
  get_start_iter(): unknown;
  get_end_iter(): unknown;
  get_text(start: unknown, end: unknown, includeHidden: boolean): string;
};
type TextView = {
  get_buffer(): TextBuffer;
  readonly has_focus: boolean;
  grab_focus(): void;
  connect(
    signal: "key-press-event",
    callback: (
      view: TextView,
      event: { get_keyval(): [boolean, number] },
    ) => boolean,
  ): void;
};
declare const imports: {
  gi: {
    versions: Record<string, string>;
    Gtk: {
      init(args: null): void;
      Window: new (properties: {
        title: string;
        default_width: number;
        default_height: number;
      }) => {
        add(editor: TextView): void;
        readonly is_active: boolean;
        connect(signal: "destroy", callback: () => void): void;
        show_all(): void;
      };
      TextView: new () => TextView;
      main_quit(): void;
      main(): void;
    };
    Gdk: { KEY_Return: number; KEY_KP_Enter: number };
    GLib: { get_monotonic_time(): number };
  };
};
imports.gi.versions.Gtk = "3.0";
imports.gi.versions.Gdk = "3.0";
const { Gtk, Gdk, GLib } = imports.gi;

declare function print(line: string): void;

Gtk.init(null);
const window = new Gtk.Window({
  title: "Apparent synthetic draft",
  default_width: 640,
  default_height: 360,
});
const editor = new Gtk.TextView();
const buffer = editor.get_buffer();
window.add(editor);
buffer.connect("changed", () => {
  const at = GLib.get_monotonic_time();
  const focused = window.is_active && editor.has_focus;
  const draft = buffer.get_text(
    buffer.get_start_iter(),
    buffer.get_end_iter(),
    true,
  );
  const bytes = Array.from(new TextEncoder().encode(draft), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  print(`draft ${at} ${Number(focused)} ${bytes}`);
});
editor.connect(
  "key-press-event",
  (_editor: unknown, event: { get_keyval(): [boolean, number] }) => {
    const [, key] = event.get_keyval();
    if (key === Gdk.KEY_Return || key === Gdk.KEY_KP_Enter) print("enter");
    return false;
  },
);
window.connect("destroy", Gtk.main_quit);
window.show_all();
editor.grab_focus();
Gtk.main();
