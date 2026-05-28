// PII Redaction Utility
// Redacts common PII patterns from text before logging

const PII_PATTERNS: { pattern: RegExp; replacement: string }[] = [
  // Email addresses
  { pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, replacement: '[EMAIL_REDACTED]' },
  // Phone numbers (various formats)
  { pattern: /\b(?:\+?1[-.]?)?\(?\d{3}\)?[-.]?\d{3}[-.]?\d{4}\b/g, replacement: '[PHONE_REDACTED]' },
  // SSN
  { pattern: /\b\d{3}-\d{2}-\d{4}\b/g, replacement: '[SSN_REDACTED]' },
  // Credit card numbers (basic pattern)
  { pattern: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g, replacement: '[CARD_REDACTED]' },
  // IP addresses
  { pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g, replacement: '[IP_REDACTED]' },
];

export function redactPII(text: string): string {
  if (!text) return text;
  return PII_PATTERNS.reduce(
    (result, { pattern, replacement }) => result.replace(pattern, replacement),
    text
  );
}

export function truncate(text: string, maxLength: number = 500): string {
  if (!text) return '';
  const redacted = redactPII(text);
  return redacted.length > maxLength
    ? redacted.slice(0, maxLength) + '...'
    : redacted;
}
