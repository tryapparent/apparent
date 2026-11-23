import Base

type CropKind is Data:
  CropFull{}
  CropFocus{}
  CropActivity{}
  CropWindow{}
  CropWindows{}
  CropFallback{}

type Candidate is Data:
  Candidate{kind: CropKind, apps: List<&2, String>}

type Publication is Data:
  Uncropped{}
  Cropped{label: String, regions: List<&2, Bool>}

type Apps is Data:
  Apps{seen: List<&2, String>, names: String}

def add_app(known: Bool, +name: String, apps: Apps) -> Apps:
  match known apps:
    case True{} _: apps
    case False{} Apps{Nil{}, names}:
      Apps{name <> Nil{}, name}
    case False{} Apps{head <> tail, names}:
      Apps{name <> head <> tail, String.append(names, String.append(" + ", name))}

def add_apps(names: List<&2, String>, apps: Apps) -> Apps:
  match names apps:
    case Nil{} _: apps
    case +name <> rest Apps{+seen, text}:
      add_apps(rest, add_app(List.contains(String, String.eq, seen, name), name, Apps{seen, text}))

def label(apps: Apps, active: Bool) -> String:
  match apps active:
    case Apps{Nil{}, names} _: "the activity"
    case Apps{_ <> _, names} True{}: String.append("the activity in ", names)
    case Apps{_ <> _, names} False{}: names

def finish(crop: Bool, active: Bool, apps: Apps, regions: List<&2, Bool>) -> Publication:
  match crop:
    case False{}: Uncropped{}
    case True{}: Cropped{label(apps, active), List.reverse(&2, Bool, regions)}

def activity(kind: CropKind) -> Bool:
  match kind:
    case CropFocus{}: True{}
    case CropActivity{}: True{}
    case _: False{}

def select(candidates: List<&2, Candidate>, crop: Bool, active: Bool, apps: Apps, regions: List<&2, Bool>) -> Publication:
  match candidates:
    case Nil{}: finish(crop, active, apps, regions)
    case Candidate{CropFull{}, names} <> tail:
      select(tail, crop, active, apps, False{} <> regions)
    case Candidate{kind, names} <> tail:
      select(tail, True{}, Bool.and(active, activity(kind)), add_apps(names, apps), True{} <> regions)

def publish(candidates: List<&2, Candidate>) -> Publication:
  select(candidates, False{}, True{}, Apps{Nil{}, ""}, Nil{})
