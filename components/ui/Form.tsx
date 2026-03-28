import React, { useState, ReactNode } from 'react';
import { ZodSchema, ZodError } from 'zod';

interface FormProps<T extends Record<string, any>> {
  schema: ZodSchema;
  onSubmit: (data: T) => void | Promise<void>;
  children: (props: FormContextType<T>) => ReactNode;
  initialValues?: T;
  className?: string;
}

interface FormContextType<T> {
  values: T;
  errors: Record<string, string>;
  touched: Record<string, boolean>;
  isSubmitting: boolean;
  handleChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => void;
  handleBlur: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => void;
  handleSubmit: (e: React.FormEvent) => Promise<void>;
  setFieldValue: (field: string, value: any) => void;
  setFieldError: (field: string, error: string) => void;
}

/**
 * Form component with Zod validation
 * Handles validation, error display, and submission
 */
export function Form<T extends Record<string, any>>({
  schema,
  onSubmit,
  children,
  initialValues,
  className = '',
}: FormProps<T>): React.JSX.Element {
  const [values, setValues] = useState<T>(initialValues || ({} as T));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    const finalValue = type === 'checkbox' ? (e.target as HTMLInputElement).checked : value;
    
    setValues((prev) => ({
      ...prev,
      [name]: finalValue,
    }));

    // Clear error on change
    if (errors[name]) {
      setErrors((prev) => ({ ...prev, [name]: '' }));
    }
  };

  const handleBlur = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name } = e.target;
    setTouched((prev) => ({ ...prev, [name]: true }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const validated = schema.parse(values);
      await onSubmit(validated);
    } catch (error) {
      if (error instanceof ZodError) {
        const newErrors: Record<string, string> = {};
        error.errors.forEach((err) => {
          const path = err.path.join('.');
          newErrors[path] = err.message;
        });
        setErrors(newErrors);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const setFieldValue = (field: string, value: any) => {
    setValues((prev) => ({ ...prev, [field]: value }));
  };

  const setFieldError = (field: string, error: string) => {
    setErrors((prev) => ({ ...prev, [field]: error }));
  };

  return (
    <form onSubmit={handleSubmit} className={className}>
      {children({
        values,
        errors,
        touched,
        isSubmitting,
        handleChange,
        handleBlur,
        handleSubmit,
        setFieldValue,
        setFieldError,
      })}
    </form>
  );
}

export default Form;
