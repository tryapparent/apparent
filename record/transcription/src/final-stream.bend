import Base

def resident_final(local_builtin: Bool, installed_model: Bool, preview_trial: Bool) -> Bool:
  Bool.and(local_builtin, Bool.not(Bool.or(installed_model, preview_trial)))

def install_resident_final(resident: Bool, configured_builtin: Bool, parakeet_preparing: Bool) -> Bool:
  Bool.and(resident, Bool.and(configured_builtin, Bool.not(parakeet_preparing)))

def eof_punctuation_start_allowance_ms() -> U32:
  80
