import { InfoIcon } from './InfoIcon';

interface NumberFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  suffix?: string;
  prefix?: string;
  step?: string;
  min?: string;
  hint?: string;
  labelHint?: string;
}

export function NumberField({ label, value, onChange, suffix, prefix, step = '1', min = '0', hint, labelHint }: NumberFieldProps) {
  return (
    <label className="field">
      <span className="field-label">
        {label}
        {labelHint && <InfoIcon text={labelHint} />}
      </span>
      <div className="field-input">
        {prefix && <span className="field-affix">{prefix}</span>}
        <input
          type="number"
          value={value}
          step={step}
          min={min}
          onChange={(e) => onChange(e.target.value)}
        />
        {suffix && <span className="field-affix">{suffix}</span>}
      </div>
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}
