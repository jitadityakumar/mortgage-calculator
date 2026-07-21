interface ValidationErrorsProps {
  issues: string[];
}

export function ValidationErrors({ issues }: ValidationErrorsProps) {
  if (issues.length === 0) return null;
  return (
    <div className="card errors" role="alert">
      <h2>Check your inputs</h2>
      <ul>
        {issues.map((issue) => (
          <li key={issue}>{issue}</li>
        ))}
      </ul>
    </div>
  );
}
