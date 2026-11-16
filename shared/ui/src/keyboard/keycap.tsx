import type {HTMLAttributes} from 'react';
import {cn} from '../utils';

/** A physical key, shared by shortcut selection, held keys and teaching motion. */
export function Keycap({className,pressed=false,...props}:HTMLAttributes<HTMLElement>&{pressed?:boolean}) {
  return <kbd className={cn('apparent-key',className)} data-pressed={pressed} {...props}/>;
}
