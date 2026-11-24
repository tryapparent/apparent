import Base

def activate_agent_context(explicit_enable: Bool, context_switch: Bool) -> Bool:
  Bool.and(explicit_enable, context_switch)

type Status is Data:
  undetermined{}
  denied{}
  granted{}
  unavailable{}

def mac_choice(requested: Bool, open_directly: Bool) -> U32:
  match requested:
    case True{}:
      2
    case False{}:
      match open_directly:
        case True{}:
          2
        case False{}:
          1

def repair_choice(copy_input: Bool, requested: Bool, open_directly: Bool) -> U32:
  match copy_input:
    case True{}:
      3
    case False{}:
      mac_choice(requested, open_directly)

def permission_repair(status: Status, requested: Bool, open_directly: Bool, copy_input: Bool) -> U32:
  match status:
    case undetermined{}:
      repair_choice(copy_input, requested, open_directly)
    case denied{}:
      repair_choice(copy_input, False{}, True{})
    case granted{}:
      0
    case unavailable{}:
      0

law unavailable_permission_has_no_repair:
  for requested: Bool
  for open_directly: Bool
  for copy_input: Bool
  {permission_repair(unavailable{}, requested, open_directly, copy_input) == 0 : U32}

def unavailable_permission_has_no_repair(requested, open_directly, copy_input):
  {==}

law denied_mac_permission_opens_settings:
  for requested: Bool
  for open_directly: Bool
  {permission_repair(denied{}, requested, open_directly, False{}) == 2 : U32}

def denied_mac_permission_opens_settings(requested, open_directly):
  {==}

type Platform is Data:
  macos{}
  wayland{}
  x11{}

def settings_rows(platform: Platform) -> U32:
  match platform:
    case macos{}:
      31
    case wayland{}:
      6
    case x11{}:
      2

type SavedPicker is Data:
  unset{}
  picker{}
  full_display{}

def screen_selection(supported: Bool, saved: SavedPicker) -> U32:
  match supported:
    case False{}:
      0
    case True{}:
      match saved:
        case unset{}:
          2
        case picker{}:
          1
        case full_display{}:
          2

def save_picker(skip: Bool) -> Bool:
  match skip:
    case False{}:
      True{}
    case True{}:
      False{}

law fresh_install_uses_full_display:
  {screen_selection(True{}, unset{}) == 2 : U32}

def fresh_install_uses_full_display():
  {==}
