import './racing-number-input.css';

/** One or two ASCII digits; leave an empty draft empty until the rider chooses. */
export const normalizeRacingNumber = (value: string): string => value.replace(/[^0-9]/g, '').slice(0, 2);

/** A standard text input with a numeric keypad works on desktop and mobile,
 * including leading-zero designs like "07"; no platform picker is required. */
export default function RacingNumberInput({ id, label, value, onChange }: {
  id?: string; label: string; value: string; onChange: (number: string) => void;
}) {
  return <input id={id} className="racing-number-input" aria-label={label}
    type="text" inputMode="numeric" pattern="[0-9]{1,2}" maxLength={2}
    enterKeyHint="done" autoComplete="off" placeholder="00–99"
    value={value} onChange={event => onChange(normalizeRacingNumber(event.currentTarget.value))} />;
}
