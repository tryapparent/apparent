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

def compact_label(kind: LineKind) -> String:
  match kind:
    case Circle{}: " Circled "
    case Speech{}: " Said: "
    case _: " "

def compact_line(+kind: LineKind, clock: String, number: String, text: String, suffix: String) -> String:
  String.append(clock, String.append(compact_label(kind), String.append(marked(number, details(kind, text)), suffix)))

def keep_frame_head(compact: Bool, scene: Bool, empty: Bool) -> Bool:
  Bool.and(empty, Bool.not(Bool.and(compact, scene)))

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

def named_window(prefix: String, app: String, separator: String, +title: String) -> String:
  String.append(prefix, String.append(app, Bool.pick(String, String.eq(title, ""), "", String.append(separator, title))))

def windows_agree(windows: List<&2, ObservedWindow>) -> Bool:
  match windows:
    case Known{id, app, title} <> rest: agrees(Known{id, app, title}, rest)
    case _: False{}

def window_suffix(windows: List<&2, ObservedWindow>) -> String:
  match windows:
    case Known{+id, +app, +title} <> rest:
      Bool.pick(String, agrees(Known{id, app, title}, rest), named_window(" · Nearby window: ", app, " — ", title), " · Window: unknown")
    case _: " · Window: unknown"

def browser_suffix(+app: String) -> String:
  Bool.pick(String, String.eq(app, "firefox"), " — Mozilla Firefox",
    Bool.pick(String, String.eq(app, "chromium"), " - Chromium",
      Bool.pick(String, Bool.or(String.eq(app, "google chrome"), String.eq(app, "google-chrome")), " - Google Chrome", "")))

def shorten_if(ends: Bool, +title: String, length: Nat) -> String:
  match ends:
    case True{}: String.take(title, Nat.sub(String.length(title), length))
    case False{}: title

def shorten_title(+title: String, +suffix: String) -> String:
  shorten_if(Bool.and(String.ends_with(title, suffix), Nat.is_lt(String.length(suffix), String.length(title))), title, String.length(suffix))

def window_heading(same: Bool, window: ObservedWindow, app_lower: String) -> String:
  match same window:
    case False{} Known{_, app, title}: named_window("Nearby: ", app, " · ", shorten_title(title, browser_suffix(app_lower)))
    case _ _: ""

type OtherLabels is Data:
  OtherLabels{count: U32, rest: List<&2, String>}

def keep_other(same: Bool, label: String, others: OtherLabels) -> OtherLabels:
  match same others:
    case True{} OtherLabels{count, rest}: OtherLabels{U32.add(count, 1), rest}
    case False{} OtherLabels{count, rest}: OtherLabels{count, label <> rest}

def other_labels(+first: String, labels: List<&2, String>) -> OtherLabels:
  match labels:
    case Nil{}: OtherLabels{1, []}
    case +next <> rest: keep_other(String.eq(first, next), next, other_labels(first, rest))

type LabelCount is Data:
  LabelCount{label: String, count: U32}

def group_head(label: String, others: OtherLabels, remaining: List<&2, String> -> List<&2, LabelCount>) -> List<&2, LabelCount>:
  match others:
    case OtherLabels{count, rest}: LabelCount{label, count} <> remaining(rest)

def group_labels_go(fuel: Nat, labels: List<&2, String>) -> List<&2, LabelCount>:
  match fuel labels:
    case 1n+remaining +label <> rest: group_head(label, other_labels(label, rest), tail => group_labels_go(remaining, tail))
    case _ _: []

def group_labels(labels: List<&2, String>) -> List<&2, LabelCount>:
  group_labels_go(3n, labels)
