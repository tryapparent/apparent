import type {ButtonHTMLAttributes} from 'react';
import './switch.css';

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>,'onChange'|'role'|'aria-checked'> & {
  checked:boolean;
  onCheckedChange:(checked:boolean)=>void;
};

export function Switch({checked,onCheckedChange,className='',...props}:Props) {
  return <button {...props} type="button" role="switch" aria-checked={checked}
    className={`apparent-switch ${className}`} onClick={()=>onCheckedChange(!checked)}>
    <span className="apparent-switch-track" aria-hidden="true"><span className="apparent-switch-thumb" /></span>
  </button>;
}
