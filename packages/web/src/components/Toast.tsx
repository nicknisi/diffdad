import { useEffect, useState } from 'react';

type Props = {
  message: string;
  onDone?: () => void;
};

export function Toast({ message, onDone }: Props) {
  const [phase, setPhase] = useState<'in' | 'hold' | 'out'>('in');

  useEffect(() => {
    const tIn = setTimeout(() => setPhase('hold'), 240);
    const tOut = setTimeout(() => setPhase('out'), 240 + 4000);
    const tEnd = setTimeout(() => onDone?.(), 240 + 4000 + 200);
    return () => {
      clearTimeout(tIn);
      clearTimeout(tOut);
      clearTimeout(tEnd);
    };
  }, [onDone]);

  const opacity = phase === 'out' ? 'opacity-0' : 'opacity-100';
  const translate = phase === 'in' ? 'translate-y-2' : 'translate-y-0';

  return (
    <div
      role="status"
      aria-live="polite"
      className={`pointer-events-none fixed bottom-20 left-1/2 z-50 -translate-x-1/2 transform transition-all duration-200 ${opacity} ${translate}`}
    >
      <div className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white shadow-lg dark:bg-gray-100 dark:text-gray-900">
        {message}
      </div>
    </div>
  );
}
