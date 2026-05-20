import React from 'react';

interface FormFieldProps {
  label: string;
  name: string;
  type?: string;
  placeholder?: string;
  value: any;
  error?: string;
  touched?: boolean;
  onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => void;
  onBlur: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => void;
  required?: boolean;
  disabled?: boolean;
  multiline?: boolean;
  options?: { label: string; value: string }[];
  className?: string;
}

/**
 * Form field component with integrated error display
 */
export const FormField: React.FC<FormFieldProps> = ({
  label,
  name,
  type = 'text',
  placeholder,
  value,
  error,
  touched,
  onChange,
  onBlur,
  required,
  disabled,
  multiline,
  options,
  className = '',
}) => {
  const hasError = touched && error;

  const baseClasses = `w-full px-4 py-2 rounded-lg border transition-all duration-200
    ${
      hasError
        ? 'border-red-300 bg-red-50 text-red-900 focus:border-red-500 focus:ring-2 focus:ring-red-200'
        : 'border-slate-200 bg-white text-slate-900 focus:border-blue-500 focus:ring-2 focus:ring-blue-100'
    }
    ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
    ${className}
  `;

  return (
    <div className="mb-4">
      <label htmlFor={name} className="block text-sm font-bold text-slate-900 mb-2">
        {label}
        {required && <span className="text-red-500 ml-1">*</span>}
      </label>

      {multiline ? (
        <textarea
          id={name}
          name={name}
          value={value}
          onChange={onChange}
          onBlur={onBlur}
          placeholder={placeholder}
          disabled={disabled}
          className={baseClasses}
          rows={4}
        />
      ) : options ? (
        <select
          id={name}
          name={name}
          value={value}
          onChange={onChange}
          onBlur={onBlur}
          disabled={disabled}
          className={baseClasses}
        >
          <option value="">{placeholder || 'Välj...'}</option>
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={name}
          name={name}
          type={type}
          value={value}
          onChange={onChange}
          onBlur={onBlur}
          placeholder={placeholder}
          disabled={disabled}
          className={baseClasses}
        />
      )}

      {hasError && <p className="mt-1 text-xs text-red-600 font-medium">{error}</p>}
    </div>
  );
};

export default FormField;
