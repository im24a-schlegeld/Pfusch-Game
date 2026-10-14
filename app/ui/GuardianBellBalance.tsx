import GuardianBell from './GuardianBell';

export default function GuardianBellBalance({ value }: { value: number }) {
  return <span className="guardian-bell-balance" aria-label={`${value} Guardian Bells`} title="Guardian Bells · eine Bell zum Weiterfahren">
    <GuardianBell size={24} /><strong>{value.toLocaleString('de-CH')}</strong>
  </span>;
}
