import React, { useState } from 'react';
import { AlertCircle, CheckCircle } from 'lucide-react';

interface PermitFormData {
  name: string;
  applicant: string;
  applicantEmail: string;
  description: string;
  wasteCode: string;
  location: string;
}

interface PermitFormProps {
  onSubmit?: (data: PermitFormData) => void;
  onCancel?: () => void;
}

const PermitForm: React.FC<PermitFormProps> = ({ onSubmit, onCancel }) => {
  const [formData, setFormData] = useState<PermitFormData>({
    name: '',
    applicant: '',
    applicantEmail: '',
    description: '',
    wasteCode: '',
    location: '',
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.name.trim()) {
      newErrors.name = 'Namn på anläggning är obligatorisk';
    }
    if (!formData.applicant.trim()) {
      newErrors.applicant = 'Sökande namn är obligatorisk';
    }
    if (!formData.applicantEmail.trim()) {
      newErrors.applicantEmail = 'E-post är obligatorisk';
    } else if (!formData.applicantEmail.includes('@')) {
      newErrors.applicantEmail = 'Giltig e-postadress krävs';
    }
    if (!formData.description.trim()) {
      newErrors.description = 'Beskrivning av verksamheten är obligatorisk';
    }
    if (!formData.wasteCode.trim()) {
      newErrors.wasteCode = 'Avfallskod är obligatorisk';
    }
    if (!formData.location.trim()) {
      newErrors.location = 'Plats för anläggning är obligatorisk';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (touched[name]) {
      setErrors((prev) => {
        const newErrors = { ...prev };
        delete newErrors[name];
        return newErrors;
      });
    }
  };

  const handleBlur = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name } = e.target;
    setTouched((prev) => ({ ...prev, [name]: true }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    setIsSubmitting(true);
    try {
      // Simulera API-anrop
      await new Promise((resolve) => setTimeout(resolve, 1000));

      setSuccess(true);
      if (onSubmit) {
        onSubmit(formData);
      }

      // Nollställ formulär efter framgång
      setTimeout(() => {
        setFormData({
          name: '',
          applicant: '',
          applicantEmail: '',
          description: '',
          wasteCode: '',
          location: '',
        });
        setSuccess(false);
      }, 2000);
    } catch (error) {
      console.error('Form submission error:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form className="permit-form" onSubmit={handleSubmit} noValidate>
      {success && (
        <div className="permit-form-success" role="alert">
          <CheckCircle size={20} />
          <span>Ansökan skickad framgångsrikt! Vi kontaktar dig snart.</span>
        </div>
      )}

      <div className="permit-form-group">
        <label htmlFor="name" className="permit-form-label">
          Namn på anläggning *
        </label>
        <input
          id="name"
          type="text"
          name="name"
          value={formData.name}
          onChange={handleChange}
          onBlur={handleBlur}
          placeholder="T.ex. Återvinningsstation Västra"
          className={`permit-form-input ${errors.name && touched.name ? 'error' : ''}`}
          aria-invalid={!!(errors.name && touched.name)}
          aria-describedby={errors.name && touched.name ? 'name-error' : undefined}
        />
        {errors.name && touched.name && (
          <span id="name-error" className="permit-form-error">
            <AlertCircle size={16} />
            {errors.name}
          </span>
        )}
      </div>

      <div className="permit-form-group">
        <label htmlFor="applicant" className="permit-form-label">
          Sökande namn *
        </label>
        <input
          id="applicant"
          type="text"
          name="applicant"
          value={formData.applicant}
          onChange={handleChange}
          onBlur={handleBlur}
          placeholder="T.ex. ACME Avfall AB"
          className={`permit-form-input ${errors.applicant && touched.applicant ? 'error' : ''}`}
          aria-invalid={!!(errors.applicant && touched.applicant)}
        />
        {errors.applicant && touched.applicant && (
          <span className="permit-form-error">
            <AlertCircle size={16} />
            {errors.applicant}
          </span>
        )}
      </div>

      <div className="permit-form-group">
        <label htmlFor="applicantEmail" className="permit-form-label">
          E-postadress *
        </label>
        <input
          id="applicantEmail"
          type="email"
          name="applicantEmail"
          value={formData.applicantEmail}
          onChange={handleChange}
          onBlur={handleBlur}
          placeholder="exempel@exempel.se"
          className={`permit-form-input ${errors.applicantEmail && touched.applicantEmail ? 'error' : ''}`}
          aria-invalid={!!(errors.applicantEmail && touched.applicantEmail)}
        />
        {errors.applicantEmail && touched.applicantEmail && (
          <span className="permit-form-error">
            <AlertCircle size={16} />
            {errors.applicantEmail}
          </span>
        )}
      </div>

      <div className="permit-form-group">
        <label htmlFor="wasteCode" className="permit-form-label">
          Avfallskod (EWC) *
        </label>
        <select
          id="wasteCode"
          name="wasteCode"
          value={formData.wasteCode}
          onChange={handleChange}
          onBlur={handleBlur}
          className={`permit-form-input ${errors.wasteCode && touched.wasteCode ? 'error' : ''}`}
          aria-invalid={!!(errors.wasteCode && touched.wasteCode)}
        >
          <option value="">Välj avfallskod</option>
          <option value="19 12 01">19 12 01 - Papper och kartong</option>
          <option value="19 12 04">19 12 04 - Plast</option>
          <option value="19 12 05">19 12 05 - Glas</option>
          <option value="19 12 09">19 12 09 - Metaller</option>
          <option value="17 01 01">17 01 01 - Betong</option>
          <option value="17 05 03">17 05 03 - Jord och stenar</option>
        </select>
        {errors.wasteCode && touched.wasteCode && (
          <span className="permit-form-error">
            <AlertCircle size={16} />
            {errors.wasteCode}
          </span>
        )}
      </div>

      <div className="permit-form-group">
        <label htmlFor="location" className="permit-form-label">
          Geografisk plats *
        </label>
        <input
          id="location"
          type="text"
          name="location"
          value={formData.location}
          onChange={handleChange}
          onBlur={handleBlur}
          placeholder="T.ex. Stockholm, Västermalm"
          className={`permit-form-input ${errors.location && touched.location ? 'error' : ''}`}
          aria-invalid={!!(errors.location && touched.location)}
        />
        {errors.location && touched.location && (
          <span className="permit-form-error">
            <AlertCircle size={16} />
            {errors.location}
          </span>
        )}
      </div>

      <div className="permit-form-group">
        <label htmlFor="description" className="permit-form-label">
          Beskrivning av verksamheten *
        </label>
        <textarea
          id="description"
          name="description"
          value={formData.description}
          onChange={handleChange}
          onBlur={handleBlur}
          placeholder="Beskriv vilken verksamhet som ska bedrivas..."
          rows={5}
          className={`permit-form-input ${errors.description && touched.description ? 'error' : ''}`}
          aria-invalid={!!(errors.description && touched.description)}
        />
        {errors.description && touched.description && (
          <span className="permit-form-error">
            <AlertCircle size={16} />
            {errors.description}
          </span>
        )}
      </div>

      <div className="permit-form-actions">
        <button type="submit" className="permit-form-btn-submit" disabled={isSubmitting}>
          {isSubmitting ? 'Skickar...' : 'Skicka ansökan'}
        </button>
        {onCancel && (
          <button type="button" className="permit-form-btn-cancel" onClick={onCancel}>
            Avbryt
          </button>
        )}
      </div>
    </form>
  );
};

export default PermitForm;
