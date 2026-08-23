interface InfoIconProps {
  text: string;
}

export function InfoIcon({ text }: InfoIconProps) {
  return (
    <span className="info-icon" tabIndex={0} title={text} aria-label={text}>
      i
    </span>
  );
}
