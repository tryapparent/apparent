import Base

def resident_final(local_builtin: Bool, installed_model: Bool, preview_trial: Bool) -> Bool:
  Bool.and(local_builtin, Bool.not(Bool.or(installed_model, preview_trial)))

def install_resident_final(resident: Bool, configured_builtin: Bool, parakeet_preparing: Bool) -> Bool:
  Bool.and(resident, Bool.and(configured_builtin, Bool.not(parakeet_preparing)))

def pause_capture(local_background: Bool, word_probe: Bool) -> Bool:
  Bool.and(local_background, word_probe)

def eof_punctuation_start_allowance_ms() -> U32:
  80

def whole_file_cpu_threads(+available: U32) -> U32:
  usable = U32.max(available, 1)
  reserved = U32.max(1, U32.sub(usable, 1))
  Bool.pick(U32, U32.is_eq(available, 0), 0, U32.min(reserved, 8))
