import { PERIOD_PRESETS, type Period } from "../lib/period";

interface Props {
  period: Period;
  onChange: (period: Period) => void;
}

export default function PeriodPicker({ period, onChange }: Props) {
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <select
        className="text-sm border border-line rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-accent/30"
        onChange={(e) => {
          const preset = PERIOD_PRESETS.find((p) => p.label === e.target.value);
          if (preset) onChange(preset.get());
        }}
        defaultValue="Last 30 days"
      >
        {PERIOD_PRESETS.map((p) => (
          <option key={p.label}>{p.label}</option>
        ))}
      </select>
      <div className="flex items-center gap-2 text-sm">
        <input
          type="date"
          value={period.start}
          onChange={(e) => onChange({ ...period, start: e.target.value })}
          className="border border-line rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-accent/30"
        />
        <span className="text-muted">to</span>
        <input
          type="date"
          value={period.end}
          onChange={(e) => onChange({ ...period, end: e.target.value })}
          className="border border-line rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-accent/30"
        />
      </div>
    </div>
  );
}
