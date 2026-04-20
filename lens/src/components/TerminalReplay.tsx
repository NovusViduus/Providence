import { useState, useEffect, useRef, useCallback } from 'react';
import { Play, Pause, RotateCcw, FastForward } from 'lucide-react';

interface TermLine {
  type: 'prompt' | 'input' | 'output';
  text: string;
  delay: number;
}

interface Session {
  id: string;
  ip: string;
  country: string;
  honeypot: string;
  category: string;
  label: string;
  duration: number;
  lines: TermLine[];
}

interface Props {
  session: Session;
  autoPlay?: boolean;
}

export default function TerminalReplay({ session, autoPlay = false }: Props) {
  const [visibleLines, setVisibleLines] = useState<{ text: string; type: string }[]>([]);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [cursor, setCursor] = useState(0);
  const [typing, setTyping] = useState('');
  const termRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const cursorRef = useRef(0);
  const speedRef = useRef(1);

  useEffect(() => { speedRef.current = speed; }, [speed]);
  useEffect(() => { cursorRef.current = cursor; }, [cursor]);

  const scrollToBottom = useCallback(() => {
    if (termRef.current) {
      termRef.current.scrollTop = termRef.current.scrollHeight;
    }
  }, []);

  const reset = useCallback(() => {
    clearTimeout(timeoutRef.current);
    setVisibleLines([]);
    setCursor(0);
    setPlaying(false);
    setTyping('');
    cursorRef.current = 0;
  }, []);

  const playLine = useCallback((idx: number) => {
    if (idx >= session.lines.length) {
      setPlaying(false);
      return;
    }

    const line = session.lines[idx];
    const delay = line.delay / speedRef.current;

    timeoutRef.current = setTimeout(() => {
      if (line.type === 'input') {
        // Type out character by character
        const prompt = visibleLines.length > 0 ? '' : '';
        let charIdx = 0;
        const typeChar = () => {
          if (charIdx <= line.text.length) {
            setTyping(line.text.slice(0, charIdx));
            charIdx++;
            scrollToBottom();
            timeoutRef.current = setTimeout(typeChar, (40 + Math.random() * 60) / speedRef.current);
          } else {
            // Done typing, commit the line
            setTyping('');
            setVisibleLines(prev => [...prev, { text: line.text, type: 'input' }]);
            setCursor(idx + 1);
            cursorRef.current = idx + 1;
            scrollToBottom();
            playLine(idx + 1);
          }
        };
        typeChar();
      } else if (line.type === 'output') {
        setVisibleLines(prev => [...prev, { text: line.text, type: 'output' }]);
        setCursor(idx + 1);
        cursorRef.current = idx + 1;
        scrollToBottom();
        playLine(idx + 1);
      } else if (line.type === 'prompt') {
        setVisibleLines(prev => [...prev, { text: line.text, type: 'prompt' }]);
        setCursor(idx + 1);
        cursorRef.current = idx + 1;
        scrollToBottom();
        playLine(idx + 1);
      }
    }, delay);
  }, [session.lines, scrollToBottom]);

  const togglePlay = useCallback(() => {
    if (playing) {
      clearTimeout(timeoutRef.current);
      setPlaying(false);
    } else {
      setPlaying(true);
      if (cursorRef.current >= session.lines.length) {
        reset();
        setTimeout(() => {
          setPlaying(true);
          playLine(0);
        }, 100);
      } else {
        playLine(cursorRef.current);
      }
    }
  }, [playing, session.lines.length, playLine, reset]);

  useEffect(() => {
    if (autoPlay) {
      setPlaying(true);
      playLine(0);
    }
    return () => clearTimeout(timeoutRef.current);
  }, []);

  // Find the last prompt for the typing cursor
  const lastPrompt = [...session.lines].reverse().find((l, i) => {
    const realIdx = session.lines.length - 1 - i;
    return l.type === 'prompt' && realIdx < cursorRef.current;
  });

  return (
    <div className="bg-[#080C12] border border-providence-border rounded-lg overflow-hidden">
      {/* Title bar */}
      <div className="flex items-center justify-between px-3 py-2 bg-[#0F1520] border-b border-providence-border/50">
        <div className="flex items-center gap-2">
          <div className="flex gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-red-500/80" />
            <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/80" />
            <div className="w-2.5 h-2.5 rounded-full bg-green-500/80" />
          </div>
          <span className="text-[10px] text-gray-500 font-mono ml-2">
            {session.ip} @ {session.honeypot} ({session.country})
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={togglePlay} className="text-gray-500 hover:text-green-400 transition-colors">
            {playing ? <Pause size={13} /> : <Play size={13} />}
          </button>
          <button onClick={reset} className="text-gray-500 hover:text-gray-300 transition-colors">
            <RotateCcw size={13} />
          </button>
          <button onClick={() => setSpeed(s => s >= 4 ? 1 : s * 2)}
            className="text-gray-500 hover:text-gray-300 transition-colors flex items-center gap-1">
            <FastForward size={13} />
            <span className="text-[9px] font-mono">{speed}x</span>
          </button>
        </div>
      </div>

      {/* Terminal body */}
      <div ref={termRef} className="p-3 font-mono text-[12px] leading-relaxed h-[320px] overflow-y-auto panel-scroll">
        {visibleLines.map((line, i) => {
          if (line.type === 'prompt') {
            return <span key={i} className="text-green-400">{line.text}</span>;
          }
          if (line.type === 'input') {
            return (
              <div key={i}>
                <span className="text-gray-200">{line.text}</span>
              </div>
            );
          }
          // output
          return (
            <div key={i} className="text-gray-400 whitespace-pre-wrap mb-1">
              {line.text}
            </div>
          );
        })}
        {/* Currently typing */}
        {typing && (
          <span className="text-gray-200">{typing}<span className="animate-pulse text-green-400">_</span></span>
        )}
        {/* Idle cursor */}
        {!typing && playing && cursor < session.lines.length && (
          <span className="animate-pulse text-green-400">_</span>
        )}
      </div>

      {/* Status bar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#0F1520] border-t border-providence-border/50 text-[9px] text-gray-600 font-mono">
        <span>{session.label}</span>
        <span>{session.duration}s session</span>
      </div>
    </div>
  );
}
