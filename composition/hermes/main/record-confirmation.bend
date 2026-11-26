import Base

def capture_occupied(available: Bool, +phase: String) -> Bool:
  Bool.and(available, Bool.not(Bool.or(String.eq(phase, "idle"), String.eq(phase, "completed"))))

def may_confirm(phase: String, availability: String) -> Bool:
  Bool.and(String.eq(phase, "confirm"), String.eq(availability, "checked"))
