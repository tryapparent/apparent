import Base

def release_action(linux: Bool) -> String:
  match linux:
    case True{}: "Install latest release"
    case False{}: "Check for updates"

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
