import { NativeSelect, NativeSelectOption } from "@apparent/ui/native-select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@apparent/ui/tooltip";

const channelDescription =
  "Stable is for everyday use. Development gets changes sooner and may be less reliable.";

export function UpdateChannel({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="settings-channel">
            <label htmlFor="update-channel" className="sr-only">
              Next install source
            </label>
            <NativeSelect
              id="update-channel"
              aria-describedby="update-channel-description"
              value={value}
              disabled={disabled}
              onChange={(event) => onChange(event.target.value)}
            >
              <NativeSelectOption value="stable">
                Stable releases
              </NativeSelectOption>
              <NativeSelectOption value="main">
                Development builds
              </NativeSelectOption>
            </NativeSelect>
            <span id="update-channel-description" hidden>
              {channelDescription}
            </span>
          </div>
        </TooltipTrigger>
        <TooltipContent
          className="settings-help-content"
          side="top"
          align="start"
        >
          <strong className="block">Next install source</strong>
          {channelDescription}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
