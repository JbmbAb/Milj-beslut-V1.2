import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  applyTemplate,
  calculateCarbon,
  evaluateStageGate,
  fetchProjectPlan,
  saveProjectPlan,
} from '../api-client/project.client';
import type { ProjectPlan } from '../../../types';

export function useProjectPlan(projectId: string) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['projectPlan', projectId],
    queryFn: () => fetchProjectPlan(projectId),
    enabled: !!projectId,
  });

  const saveMutation = useMutation({
    mutationFn: (plan: ProjectPlan) => saveProjectPlan(projectId, plan),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projectPlan', projectId] });
    },
  });

  const applyTemplateMutation = useMutation({
    mutationFn: (vars: { templateId: string; plan: ProjectPlan }) =>
      applyTemplate(projectId, vars.templateId, vars.plan),
    onSuccess: (newPlan) => {
      queryClient.setQueryData(['projectPlan', projectId], newPlan);
    },
  });

  const evaluateGateMutation = useMutation({
    mutationFn: (vars: { gateId: string; context: Record<string, unknown> }) =>
      evaluateStageGate(projectId, vars.gateId, vars.context),
    onSuccess: (result) => {
      queryClient.setQueryData(['projectPlan', projectId], result.plan);
    },
  });

  const calculateCarbonMutation = useMutation({
    mutationFn: (vars: { carbonInput: Record<string, unknown>; plan: ProjectPlan }) =>
      calculateCarbon(projectId, vars.carbonInput, vars.plan),
    onSuccess: (newPlan) => {
      queryClient.setQueryData(['projectPlan', projectId], newPlan);
    },
  });

  return {
    plan: query.data,
    isLoading: query.isLoading,
    error: query.error,
    savePlan: saveMutation.mutateAsync,
    isSaving: saveMutation.isPending,
    applyTemplate: applyTemplateMutation.mutateAsync,
    isApplyingTemplate: applyTemplateMutation.isPending,
    evaluateGate: evaluateGateMutation.mutateAsync,
    isEvaluatingGate: evaluateGateMutation.isPending,
    calculateCarbon: calculateCarbonMutation.mutateAsync,
    isCalculatingCarbon: calculateCarbonMutation.isPending,
  };
}
