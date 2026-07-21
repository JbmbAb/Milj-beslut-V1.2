import { useQuery } from '@tanstack/react-query';
import {
  fetchSewageRequirementChecklist,
  type SewageRequirementChecklistRequest,
} from '../../../services/sewageApi';

export function useSewageRequirementChecklist(params: SewageRequirementChecklistRequest) {
  return useQuery({
    queryKey: ['sewage', 'requirement-checklist', params],
    queryFn: () => fetchSewageRequirementChecklist(params),
    enabled: Boolean(params.systemType && params.municipalityCode),
  });
}
