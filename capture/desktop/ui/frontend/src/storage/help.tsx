import { useState, type ReactNode } from 'react';
import { CircleHelp } from 'lucide-react';
import { Button } from '@apparent/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@apparent/ui/tooltip';

/** Optional explanation stays available to pointer, keyboard and touch users. */
export function Help({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <TooltipProvider delayDuration={150}><Tooltip open={open} onOpenChange={setOpen}>
    <TooltipTrigger asChild><Button variant="ghost" size="icon" className="settings-help" aria-label={label}
      onClick={event => { event.preventDefault(); setOpen(!open); }}>
      <CircleHelp aria-hidden="true" />
    </Button></TooltipTrigger>
    <TooltipContent className="settings-help-content" side="bottom" align="start">{children}</TooltipContent>
  </Tooltip></TooltipProvider>;
}
