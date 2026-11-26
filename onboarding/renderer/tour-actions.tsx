import { Button } from "@apparent/ui/button";

type Action = "later" | "skip-pen";

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
