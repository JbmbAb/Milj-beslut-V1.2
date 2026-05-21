export interface ComplianceScore {
  score: number;
  totalSteps: number;
  completedSteps: number;
  missingDocuments: string[];
}

export interface FormField {
  id: string;
  label: string;
  type: 'text' | 'number' | 'textarea' | 'select';
  required: boolean;
  value: string;
  options?: string[];
}

export interface EnvironmentalForm {
  id: string;
  title: string;
  wasteCode: string;
  sections: {
    title: string;
    fields: FormField[];
  }[];
}

export interface SpeciesObservation {
  name: string;
  status: 'Rödlistad' | 'Fridlyst' | 'Livskraftig';
  distance: number;
}

export interface WeatherRisk {
  level: 'Låg' | 'Medel' | 'Hög';
  description: string;
  action: string;
  source: string;
  fetchedAt: string;
  municipality?: string;
  coordinates?: { lat: number; lng: number } | null;
  summary?: {
    airTemperatureC: number | null;
    precipitationMmPerHour: number | null;
    gustMs: number | null;
    thunderstormRiskPct: number | null;
  };
}

export interface Stats {
  total: number;
  bifall: number;
  avslag: number;
  municipalities: number;
}

export interface Task {
  id: string;
  title: string;
  startWeek: number;
  duration: number;
  type: 'LEGAL' | 'TECHNICAL' | 'FIELD' | 'ADMIN';
  status: 'DONE' | 'ONGOING' | 'TODO';
}

