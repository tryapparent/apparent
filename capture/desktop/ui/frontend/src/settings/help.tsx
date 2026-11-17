import {useState} from 'react';
import {Button} from '@apparent/ui/button';
import {Tooltip,TooltipTrigger,TooltipContent,TooltipProvider} from '@apparent/ui/tooltip';
import {Info} from 'lucide-react';
export function Help({label,children}:{label:string;children:string}) {
  const [open,setOpen]=useState(false);
  return <TooltipProvider delayDuration={200}><Tooltip open={open} onOpenChange={setOpen}>
    <TooltipTrigger asChild><Button type="button" variant="ghost" className="settings-help" aria-label={label} onClick={()=>setOpen(true)}><Info aria-hidden="true" /></Button></TooltipTrigger>
    <TooltipContent className="settings-help-content settings-agents-help">{children}</TooltipContent>
  </Tooltip></TooltipProvider>;
}
