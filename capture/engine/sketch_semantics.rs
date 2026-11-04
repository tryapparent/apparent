pub use apparent_inspect::semantics::*;
pub fn summary_markdown(bundle: &crate::shared::model::ApparentBundle, dir: &std::path::Path) -> String {
    summary_markdown_with(bundle, dir, crate::shared::handoff::experiment(crate::shared::handoff::AGENT_CONTEXT))
}
pub(crate) fn clipboard_markdown(bundle: &crate::shared::model::ApparentBundle, dir: &std::path::Path, hosted: bool) -> String {
    apparent_inspect::semantics::clipboard_markdown(bundle, dir, hosted, crate::shared::handoff::experiment(crate::shared::handoff::AGENT_CONTEXT))
}
