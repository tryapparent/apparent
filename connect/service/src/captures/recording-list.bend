import Base

def valid_limit(+limit: U32) -> Bool:
  Bool.and((limit > 0 : U32), (limit <= 50 : U32))

def valid_recording_day(+day: U32) -> Bool:
  (day <= 2932896 : U32)
