import Base

type LineKind is Data:
  Action{}
  Circle{}
  Mark{}
  Note{}
  Speech{}

def label(kind: LineKind) -> String:
  match kind:
    case Action{}: " Action: "
    case Circle{}: " Circled: "
    case Mark{}: " Mark: "
    case Note{}: " "
    case Speech{}: " Said: "

def details(kind: LineKind, +text: String) -> String:
  match kind:
    case Circle{}: Bool.pick(String, String.eq(text, ""), "target unidentified", text)
    case Speech{}: String.append("“", String.append(text, "”"))
    case _: text

def marked(+number: String, +text: String) -> String:
  Bool.pick(String, String.eq(number, ""), text, String.append(number, String.append(" ", text)))

def line(+kind: LineKind, clock: String, number: String, text: String, suffix: String) -> String:
  String.append(clock, String.append(label(kind), String.append(marked(number, details(kind, text)), suffix)))

type ObservedWindow is Data:
  Known{id: String, app: String, title: String}
  Unknown{}

def same_window(+window: ObservedWindow, other: ObservedWindow) -> Bool:
  match window other:
    case Known{id, app, title} Known{other_id, other_app, other_title}:
      Bool.and(String.eq(id, other_id), Bool.and(String.eq(app, other_app), String.eq(title, other_title)))
    case _ _: False{}

def agrees(+window: ObservedWindow, windows: List<&2, ObservedWindow>) -> Bool:
  match windows:
    case Nil{}: True{}
    case head <> tail: Bool.and(same_window(window, head), agrees(window, tail))

def named_window(+app: String, +title: String) -> String:
  String.append(" · Nearby window: ", String.append(app, Bool.pick(String, String.eq(title, ""), "", String.append(" — ", title))))

def window_suffix(windows: List<&2, ObservedWindow>) -> String:
  match windows:
    case Known{+id, +app, +title} <> rest:
      Bool.pick(String, agrees(Known{id, app, title}, rest), named_window(app, title), " · Window: unknown")
    case _: " · Window: unknown"
