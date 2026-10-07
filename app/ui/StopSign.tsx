/** Decorative STOP mark; its parent supplies the accessible label. */
export default function StopSign({ active = true, className }: { active?: boolean; className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 100 100"
      width="1em"
      height="1em"
      aria-hidden="true"
      focusable="false"
      data-active={active}
    >
      <path
        d="M30 3H70L97 30V70L70 97H30L3 70V30Z"
        fill={active ? '#d5252b' : '#555555'}
        stroke="#ffffff"
        strokeWidth="3"
      />
      <text
        x="50"
        y="51"
        fill="#ffffff"
        textAnchor="middle"
        dominantBaseline="middle"
        fontFamily="Arial, sans-serif"
        fontWeight="900"
        fontSize="27"
        letterSpacing="-1"
      >
        STOP
      </text>
    </svg>
  );
}
