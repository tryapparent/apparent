import Base

def may_copy(saved: Bool, current: Bool, connected: Bool) -> Bool:
  match current:
    case False{}:
      False{}
    case True{}:
      Bool.and(saved, connected)

law stale_cannot_copy:
  for saved: Bool
  for connected: Bool
  {may_copy(saved, False{}, connected) == False{} : Bool}

def stale_cannot_copy(saved, connected):
  {==}

def copy_mode(local_screen: Bool, hyprland: Bool, wayland: Bool, draft: Bool, submit: Bool) -> U32:
  Bool.pick(U32, Bool.and(local_screen, Bool.and(hyprland, wayland)), Bool.pick(U32, draft, 1, Bool.pick(U32, submit, 2, 0)), 0)
