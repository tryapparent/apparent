import Base

type Probe is Data:
  Found{index: U32}
  Missing{}
  Failed{index: U32}

type Probes is Data:
  End{}
  Next{probe: Probe, tail: Probes}

type Route is Data:
  Use{index: U32}
  Report{index: U32}
  Retry{}
  Unavailable{}

def consider(probe: Probe, rest: Route, can_wait: Bool) -> Route:
  match probe rest can_wait:
    case Found{index} _ _:
      Use{index}
    case _ Use{index} _:
      Use{index}
    case Missing{} _ True{}:
      Retry{}
    case _ Retry{} _:
      Retry{}
    case Failed{index} _ _:
      Report{index}
    case Missing{} Report{index} _:
      Report{index}
    case Missing{} Unavailable{} _:
      Unavailable{}

def reader_route(probes: Probes, +can_wait: Bool) -> Route:
  match probes:
    case End{}:
      Unavailable{}
    case Next{probe, tail}:
      consider(probe, reader_route(tail, can_wait), can_wait)

law matching_reader_wins_over_failure:
  for index: U32
  {reader_route(Next{Failed{0}, Next{Found{index}, End{}}}, True{}) == Use{index} : Route}

def matching_reader_wins_over_failure(index):
  {==}

law missing_reader_can_retry:
  {reader_route(Next{Missing{}, End{}}, True{}) == Retry{} : Route}

def missing_reader_can_retry():
  {==}
