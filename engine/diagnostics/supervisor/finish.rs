use serde::{Deserialize, Serialize};
use std::io::Write;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub(in crate::capture::desktop) enum FinishPhase {
    StoppingSource,
    PreparingBundle,
    BuildingBundle,
    PublishingBundle,
    FinalizerReturned,
}

impl FinishPhase {
    pub(super) fn marker(self) -> &'static str {
        match self {
            Self::StoppingSource => "apparent-native-finish: stopping_source",
            Self::PreparingBundle => "apparent-native-finish: preparing_bundle",
            Self::BuildingBundle => "apparent-native-finish: building_bundle",
            Self::PublishingBundle => "apparent-native-finish: publishing_bundle",
            Self::FinalizerReturned => "apparent-native-finish: finalizer_returned",
        }
    }

    pub(super) fn from_marker(line: &[u8]) -> Option<Self> {
        [
            Self::StoppingSource,
            Self::PreparingBundle,
            Self::BuildingBundle,
            Self::PublishingBundle,
            Self::FinalizerReturned,
        ]
        .into_iter()
        .find(|phase| phase.marker().as_bytes() == line)
    }

    pub(in crate::capture::desktop) fn emit(self) {
        let _ = writeln!(std::io::stderr(), "{}", self.marker());
    }
}
