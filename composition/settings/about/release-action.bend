import Base

def release_action(linux: Bool) -> String:
  match linux:
    case True{}: "Install latest channel release"
    case False{}: "Check for updates"
