import Base

def preview_allowed(enabled: Bool, supported: Bool) -> Bool:
  match enabled:
    case True{}:
      supported
    case False{}:
      False{}

def openrouter_model_allowed(model: String) -> Bool:
  String.eq(model, "microsoft/mai-transcribe-2")

def openrouter_allowed(enabled: Bool, model: String) -> Bool:
  match enabled:
    case True{}:
      openrouter_model_allowed(model)
    case False{}:
      False{}
