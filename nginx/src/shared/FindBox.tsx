import { useEffect, useState, type Ref } from "react";

// Debounces a fast-changing value (an <input> as the reader types) so a
// listener that scans a whole document does not run on every keystroke.
// Shared by every viewer's find box.
export function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

export function FindBox({
  value,
  onChange,
  placeholder,
  hitsLabel,
  inputRef,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  hitsLabel?: string;
  inputRef?: Ref<HTMLInputElement>;
}) {
  return (
    <>
      <input
        ref={inputRef}
        className="find"
        type="search"
        placeholder={placeholder}
        spellCheck={false}
        value={value}
        onChange={e => onChange(e.target.value)}
      />
      {hitsLabel !== undefined && <span className="muted find-hits">{hitsLabel}</span>}
    </>
  );
}
