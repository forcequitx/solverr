import { SearchSelect } from "@/components/ui/search-select";

/** Pill-shaped list filter built on SearchSelect's menu; `options` are [value, label] pairs. */
export function FilterSelect({ label, value, options, onChange }: { label: string; value: string; options: [string, string][]; onChange: (value: string) => void }) {
  return <SearchSelect size="sm" label={label} value={value} options={options.map(([optionValue, optionLabel]) => ({ value: optionValue, label: optionLabel }))} onChange={onChange} />;
}
