import './racing-number-input.css';

const numbers = [...Array.from({ length: 10 }, (_, i) => String(i)), ...Array.from({ length: 100 }, (_, i) => String(i).padStart(2, '0'))];

/** Native pickers work without an on-screen keyboard or the 3D number font. */
export default function RacingNumberInput({ id, label, value, onChange }: {
  id?: string; label: string; value: string; onChange: (number: string) => void;
}) {
  return <select id={id} className="racing-number-input" aria-label={label} value={value}
    onChange={event => onChange(event.target.value)}>
    <option value="">Nummer wählen</option>
    {numbers.map(number => <option key={number} value={number}>{number}</option>)}
  </select>;
}
