import { Button } from "@apparent/ui/button";

type Action = "later" | "skip-pen" | "skip-shortcut-trial";

export function TourAction({
  action,
  onAction,
  disabled,
}: {
  action: Action;
  onAction(action: Action): Promise<void>;
  disabled?: boolean;
}) {
  const label = {
    later: "Later",
    "skip-pen": "Keep current pen",
    "skip-shortcut-trial": "Skip shortcut practice",
  }[action];
  return (
    <Button
      variant="ghost"
      disabled={disabled}
      onClick={() => void onAction(action)}
    >
      {label}
    </Button>
  );
}
