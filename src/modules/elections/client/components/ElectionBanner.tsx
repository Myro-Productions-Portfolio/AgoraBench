import { useState, useEffect } from 'react';

interface ElectionBannerProps {
  title: string;
  description: string;
  targetDate: Date | null;
}

interface TimeRemaining {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

function calculateTimeRemaining(target: Date): TimeRemaining {
  const now = new Date();
  const diff = Math.max(0, target.getTime() - now.getTime());

  return {
    days: Math.floor(diff / (1000 * 60 * 60 * 24)),
    hours: Math.floor((diff / (1000 * 60 * 60)) % 24),
    minutes: Math.floor((diff / (1000 * 60)) % 60),
    seconds: Math.floor((diff / 1000) % 60),
  };
}

export function ElectionBanner({ title, description, targetDate }: ElectionBannerProps) {
  const [time, setTime] = useState<TimeRemaining>(calculateTimeRemaining(targetDate ?? new Date()));

  useEffect(() => {
    if (!targetDate) return;
    const interval = setInterval(() => {
      setTime(calculateTimeRemaining(targetDate));
    }, 1000);
    return () => clearInterval(interval);
  }, [targetDate]);

  if (!targetDate) {
    return (
      <div
        className="rounded-card border border-border p-6 flex items-center justify-between mb-8"
        style={{
          background:
            'linear-gradient(135deg, rgba(184, 149, 106, 0.05) 0%, rgba(201, 185, 155, 0.02) 100%)',
        }}
        role="banner"
        aria-label="Election status"
      >
        <div>
          <h3 className="font-serif text-xl text-stone mb-1">{title}</h3>
          <p className="text-sm text-text-secondary">{description}</p>
        </div>
        <div className="text-sm text-text-muted italic">No upcoming election scheduled</div>
      </div>
    );
  }

  const units = [
    { value: time.days, label: 'Days' },
    { value: time.hours, label: 'Hours' },
    { value: time.minutes, label: 'Min' },
    { value: time.seconds, label: 'Sec' },
  ];

  return (
    <div
      className="rounded-card border border-gold/25 p-6 flex items-center justify-between mb-8"
      style={{
        background:
          'linear-gradient(135deg, rgba(184, 149, 106, 0.1) 0%, rgba(201, 185, 155, 0.05) 100%)',
      }}
      role="banner"
      aria-label="Election countdown"
    >
      <div>
        <h3 className="font-serif text-xl text-stone mb-1">{title}</h3>
        <p className="text-sm text-text-secondary">{description}</p>
      </div>
      <div className="flex gap-4" aria-live="polite">
        {units.map((unit) => (
          <div key={unit.label} className="text-center min-w-[56px]">
            <div className="font-mono text-[1.75rem] text-gold bg-capitol-deep px-2 py-1 rounded border border-border">
              {String(unit.value).padStart(2, '0')}
            </div>
            <div className="text-[0.6rem] text-text-muted uppercase tracking-wider mt-1">
              {unit.label}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
