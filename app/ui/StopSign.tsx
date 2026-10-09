import './stop-sign.css';

/** Decorative supplied STOP artwork; its parent supplies the accessible label. */
export default function StopSign({ active = true, className = '' }: { active?: boolean; className?: string }) {
  return (
    <img
      className={`stop-sign ${className}`}
      src="/images/stop-sign.png"
      alt=""
      width={600}
      height={600}
      aria-hidden="true"
      draggable={false}
      data-active={active}
    />
  );
}
