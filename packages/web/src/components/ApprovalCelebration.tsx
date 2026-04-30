import { useEffect, useMemo } from 'react';

type Props = {
  onDone: () => void;
};

export function ApprovalCelebration({ onDone }: Props) {
  useEffect(() => {
    const t = setTimeout(onDone, 3500);
    return () => clearTimeout(t);
  }, [onDone]);

  const particles = useMemo(
    () =>
      Array.from({ length: 20 }, (_, i) => ({
        id: i,
        left: Math.random() * 100,
        delay: Math.random() * 1.5,
        duration: 2 + Math.random() * 2,
        size: 6 + Math.random() * 6,
        color: ['var(--brand)', 'var(--green-9)', 'var(--amber-9)', '#EC4899', 'var(--purple-9)'][i % 5],
        rotation: Math.random() * 360,
      })),
    [],
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{
        background: 'rgba(0,0,0,0.3)',
        animation: 'celebration-in 0.4s ease-out',
      }}
      onClick={onDone}
    >
      {particles.map((p) => (
        <div
          key={p.id}
          className="absolute rounded-sm"
          style={{
            left: `${p.left}%`,
            top: -20,
            width: p.size,
            height: p.size,
            background: p.color,
            animation: `confetti-fall ${p.duration}s ease-in ${p.delay}s forwards`,
            transform: `rotate(${p.rotation}deg)`,
          }}
        />
      ))}

      <div
        className="flex flex-col items-center gap-4 rounded-2xl bg-[var(--bg-panel)] p-10 text-center"
        style={{
          animation: 'celebration-in 0.5s ease-out',
          boxShadow: '0 24px 48px -8px rgba(3,2,13,0.25)',
        }}
      >
        <div
          className="flex h-16 w-16 items-center justify-center rounded-full text-white text-2xl"
          style={{ background: 'var(--green-9)' }}
        >
          ✓
        </div>
        <div className="text-[28px] font-bold tracking-tight text-[var(--fg-1)]">Proud of you, champ.</div>
        <div className="text-sm text-[var(--fg-2)]">Review approved and sent to GitHub</div>
      </div>
    </div>
  );
}
