import Base

def start_request(refresh_expired: Bool, access_due: Bool) -> String:
  match refresh_expired access_due:
    case True{} _:
      "force"
    case False{} True{}:
      "renew"
    case False{} False{}:
      "send"

def before_request(refresh_expired: Bool, access_seconds: U32) -> String:
  start_request(refresh_expired, U32.is_lt(access_seconds, 31))

def plan_locked(changed: Bool, force: Bool, access_due: Bool, has_refresh: Bool) -> String:
  match changed force access_due has_refresh:
    case True{} _ _ _:
      "reuse"
    case False{} False{} False{} _:
      "reuse"
    case False{} _ _ False{}:
      "reapprove"
    case False{} _ _ True{}:
      "readJournal"

def under_renewal_lock(changed: Bool, force: Bool, access_seconds: U32, has_refresh: Bool) -> String:
  plan_locked(changed, force, U32.is_lt(access_seconds, 31), has_refresh)

def resume_renewal(completed: Bool, refresh_expired: Bool) -> String:
  match completed refresh_expired:
    case True{} _:
      "recover"
    case False{} True{}:
      "reapprove"
    case False{} False{}:
      "exchange"

def after_transport(rejected: Bool, can_retry: Bool) -> String:
  match rejected can_retry:
    case False{} _:
      "return"
    case True{} True{}:
      "renew"
    case True{} False{}:
      "reapprove"

law completed_rotation_survives_expiry:
  for expired: Bool
  {resume_renewal(True{}, expired) == "recover" : String}

def completed_rotation_survives_expiry(expired):
  {==}

law concurrent_rotation_is_reused:
  for force: Bool
  for seconds: U32
  for has_refresh: Bool
  {under_renewal_lock(True{}, force, seconds, has_refresh) == "reuse" : String}

def concurrent_rotation_is_reused(force, seconds, has_refresh):
  {==}
