import Base

def release_action(linux: Bool, current: Bool) -> String:
  match linux current:
    case _ True{}: "Check again"
    case True{} False{}: "Update"
    case False{} False{}: "Check for updates"

def digits(text: String) -> Bool:
  match text:
    case SNil{}: True{}
    case SCon{head, tail}: Bool.and(Char.is_digit(head), digits(tail))

def version_component(text: String) -> Bool:
  match text:
    case SNil{}: False{}
    case SCon{head, tail}: Bool.and(Char.is_digit(head), digits(tail))

def stable_tag(valid_prefix: Bool, id: String) -> Bool:
  match valid_prefix:
    case False{}: False{}
    case True{}:
      List.all(&2, String, version_component, String.split(String.drop(id, 1n), '.'))

def stable_note(valid: Bool, id: String) -> String:
  match valid:
    case True{}: String.append("Restart to use Stable ", String.append(id, "."))
    case False{}: "Restart to use the installed Stable release."

def hex_digit(+c: Char) -> Bool:
  Bool.or(Char.is_digit(c), String.contains("abcdef", SCon{Char.to_lower(c), SNil{}}))

def hex_digits(text: String) -> Bool:
  match text:
    case SNil{}: True{}
    case SCon{head, tail}: Bool.and(hex_digit(head), hex_digits(tail))

def development_note(valid: Bool, id: String) -> String:
  match valid:
    case True{}: String.append("Restart to use Development build ", String.append(String.take(id, 8n), "."))
    case False{}: "Restart to use the installed Development build."

def staged_note(stable: Bool, main: Bool, +id: String) -> String:
  match stable main:
    case True{} _:
      stable_note(stable_tag(Bool.and(Nat.is_le(String.length(id), 64n), String.starts_with(id, "v")), id), id)
    case False{} True{}: development_note(Bool.and(Nat.is_eq(String.length(id), 40n), hex_digits(id)), id)
    case False{} False{}: "Restart to use the installed update."

def staged_release_note(+channel: String, id: String) -> String:
  staged_note(String.eq(channel, "stable"), String.eq(channel, "main"), id)

def show_restart(pending: Bool, checking: Bool) -> Bool:
  match checking:
    case True{}: False{}
    case False{}: pending

def show_failure(failed: Bool, restart_failure: Bool, restart: Bool) -> Bool:
  match restart_failure:
    case True{}: restart
    case False{}: failed

def show_unstaged_restart_failure(restart_failure: Bool, restart: Bool) -> Bool:
  match restart:
    case True{}: False{}
    case False{}: restart_failure
