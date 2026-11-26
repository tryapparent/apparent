export function bindNotesEscape(
  element: HTMLElement | null,
  mode: "badge" | "editor" | "list",
  dismiss: () => void,
) {
  if (!element || mode === "badge") return;
  const { ownerDocument } = element;
  function handleEscape(event: KeyboardEvent) {
    if (event.key !== "Escape" || event.isComposing || event.defaultPrevented)
      return;
    event.preventDefault();
    if (!event.repeat) dismiss();
  }
  ownerDocument.addEventListener("keydown", handleEscape);
  return () => ownerDocument.removeEventListener("keydown", handleEscape);
}
