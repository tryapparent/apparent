import Base

type Admission is Data:
  Disabled{}
  Closed{}
  Full{}
  Begin{}

def admit(enabled: Bool, closed: Bool, full: Bool) -> Admission:
  Bool.pick(Admission, enabled, Bool.pick(Admission, closed, Closed{}, Bool.pick(Admission, full, Full{}, Begin{})), Disabled{})
