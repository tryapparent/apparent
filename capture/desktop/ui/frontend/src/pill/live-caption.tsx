import {useLayoutEffect, useRef, useState} from 'react';
import {preview, type Preview} from '../../../../../../record/transcription/src/policy';
export function LiveCaption({value}: {value: Preview}) {
  const viewport = useRef<HTMLDivElement>(null), line = useRef<HTMLDivElement>(null);
  const [shift, setShift] = useState(0);
  const content = preview(value, true)!;
  const text = content.failed ? 'Live text unavailable. Recording continues.' : content.text;
  useLayoutEffect(() => {
    let active = true;
    const measure = () => {if (active && line.current && viewport.current) setShift(Math.max(0, line.current.scrollWidth - viewport.current.clientWidth));};
    measure(); void document.fonts.ready.then(measure);
    const observer = new ResizeObserver(measure);
    if (viewport.current) observer.observe(viewport.current);
    return () => {active = false; observer.disconnect();};
  }, [text]);
  return <div className="live-caption" data-failed={content.failed}>
    <div ref={viewport} className="live-caption__viewport" data-overflow={shift > 0} aria-label="Live local transcription" aria-live="off" title={text}>
      <div ref={line} className="live-caption__line" style={{transform: `translateX(-${shift}px)`}}>
        <span>{text}</span>{!content.failed && <span className="live-caption__caret" aria-hidden="true" />}
      </div>
    </div>
  </div>;
}
