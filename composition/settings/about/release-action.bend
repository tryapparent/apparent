import Base

def recovery_install(main: Bool, stable: Bool) -> String:
  match main stable:
    case True{} _: "Install latest Development build"
    case False{} True{}: "Install latest Stable release"
    case False{} False{}: "Install latest release"

def release_action(linux: Bool, unconfirmed: Bool, +selected_channel: String) -> String:
  match linux unconfirmed:
    case True{} True{}:
      recovery_install(String.eq(selected_channel, "main"), String.eq(selected_channel, "stable"))
    case True{} False{}: "Install latest release"
    case False{} _: "Check for updates"

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
    case True{}: String.append("Stable release ", String.append(id, " is installed."))
    case False{}: "A Stable release is installed."

def staged_note(stable: Bool, main: Bool, +id: String) -> String:
  match stable main:
    case True{} _:
      stable_note(stable_tag(Bool.and(Nat.is_le(String.length(id), 64n), String.starts_with(id, "v")), id), id)
    case False{} True{}: "A Development build is installed."
    case False{} False{}: "An update is installed."

def staged_release_note(+channel: String, id: String) -> String:
  staged_note(String.eq(channel, "stable"), String.eq(channel, "main"), id)

def show_restart(pending: Bool, checking: Bool) -> Bool:
  match checking:
    case True{}: False{}
    case False{}: pending

def show_restart_later(restart: Bool, offer: Bool) -> Bool:
  match restart:
    case True{}: offer
    case False{}: False{}

def show_failure(failed: Bool, restart_failure: Bool, restart: Bool) -> Bool:
  match restart_failure:
    case True{}: restart
    case False{}: failed

def show_unstaged_restart_failure(restart_failure: Bool, restart: Bool) -> Bool:
  match restart:
    case True{}: False{}
    case False{}: restart_failure
