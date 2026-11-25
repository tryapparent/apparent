import {useCallback, useRef, useState} from 'react';
import {Button} from '@apparent/ui/button';
import {ErrorDialog} from '@apparent/ui/error-dialog';
import frog from '../../../../../assets/settings/frog-puzzled.png';
import {Copy,Check} from 'lucide-react';
import {skillCommand} from './policy';

import {Help} from '../help';
export function Agents() {
  const [copied,setCopied]=useState(false),[copyError,setCopyError]=useState(false);
  const skillSection = useRef<HTMLElement | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const connectSkillSection = useCallback((node: HTMLElement | null) => {
    if (!node) return;
    skillSection.current = node;
    return () => {
      skillSection.current = null;
      clearTimeout(copyTimer.current);
    };
  }, []);
  async function copy() {
    clearTimeout(copyTimer.current);
    setCopied(false);
    try {
      await window.apparentAgents.copySkill();
      if (!skillSection.current) return;
      clearTimeout(copyTimer.current);
      setCopied(true);
      setCopyError(false);
      copyTimer.current = setTimeout(() => setCopied(false), 2500);
    } catch {
      if (skillSection.current) setCopyError(true);
    }
  }

  return <div className="settings-agents">
    <section ref={connectSkillSection} className="settings-agent-skill" aria-labelledby="agent-skill-label">
      <div className="agent-heading"><h2 id="agent-skill-label">Agent skill</h2><Help label="About the agent skill">Optional: run this in a terminal to teach Claude Code, OpenCode, Codex and other agents to read your captures. This is not needed to connect T3.</Help></div>
      <div className="agent-command"><code>{skillCommand.split('/').map((part,index)=><span key={index}>{index>0&&<>/<wbr/></>}{part}</span>)}</code><Button variant="ghost" className="agent-copy" aria-label="Copy install command" onClick={()=>void copy()}>{copied?<Check aria-hidden="true" />:<Copy aria-hidden="true" />}</Button></div>
      <span role="status" className="settings-metadata">{copied?'Copied':''}</span>
    </section>
    <ErrorDialog open={copyError} title="Unable to copy command" description="Select the command and copy it manually, or try again." artwork={<img src={frog} alt=""/>} recoveryLabel="Try again" onRecover={()=>void copy()} onClose={()=>setCopyError(false)}/>
  </div>;
}
