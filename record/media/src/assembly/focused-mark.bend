import Base

def admit_focused_mark(inside: Bool, clear: Bool, same_window: Bool, same_tree: Bool) -> Bool:
  Bool.and(inside, Bool.and(clear, Bool.and(same_window, same_tree)))

def prefer_mark_role(candidate: U32, selected: U32) -> Bool:
  U32.is_gt(candidate, selected)

def admit_mark_identity(target_role: Bool, identity: Bool) -> Bool:
  Bool.and(target_role, identity)
