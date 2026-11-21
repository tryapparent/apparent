import Base

def admit_focused_mark(inside: Bool, clear: Bool, same_window: Bool, same_tree: Bool) -> Bool:
  Bool.and(inside, Bool.and(clear, Bool.and(same_window, same_tree)))
