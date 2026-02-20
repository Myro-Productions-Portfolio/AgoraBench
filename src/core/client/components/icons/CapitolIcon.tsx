interface CapitolIconProps {
  className?: string;
}

export function CapitolIcon({ className = 'w-8 h-8' }: CapitolIconProps) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M16 2L4 12V28H12V20H20V28H28V12L16 2Z"
        stroke="#C9B99B"
        strokeWidth="1.5"
        fill="none"
      />
      <path d="M10 12H22" stroke="#C9B99B" strokeWidth="1.5" />
      <circle cx="16" cy="8" r="2" stroke="#B8956A" strokeWidth="1.2" fill="none" />
      <path d="M8 28V15" stroke="#C9B99B" strokeWidth="1" />
      <path d="M24 28V15" stroke="#C9B99B" strokeWidth="1" />
      <path
        d="M12 28V15"
        stroke="#C9B99B"
        strokeWidth="0.75"
        strokeDasharray="1 2"
      />
      <path
        d="M20 28V15"
        stroke="#C9B99B"
        strokeWidth="0.75"
        strokeDasharray="1 2"
      />
    </svg>
  );
}
