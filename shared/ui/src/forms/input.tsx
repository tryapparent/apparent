import type {ComponentProps} from 'react';
import {cn} from '../utils';

export function Input({className,...props}:ComponentProps<'input'>) {
 return <input data-slot="input" className={cn('flex min-h-11 w-full min-w-0 rounded-none border border-foreground bg-background px-3 py-2 font-[inherit] text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50',className)} {...props} />;
}
