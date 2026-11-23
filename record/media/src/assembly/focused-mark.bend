import Base

def admit_focused_mark(inside: Bool, clear: Bool, same_window: Bool, same_tree: Bool) -> Bool:
  Bool.and(inside, Bool.and(clear, Bool.and(same_window, same_tree)))

def admit_browser_page(point_confirmed: Bool, preceded_by_mark: Bool, same_page: Bool) -> Bool:
  Bool.and(point_confirmed, Bool.or(Bool.not(preceded_by_mark), same_page))
