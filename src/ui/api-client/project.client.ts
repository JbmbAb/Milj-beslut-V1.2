/**
 * PROJECT API CLIENT
 */

import type { ProjectPlan } from '../../../types';

export async function fetchProjectPlan(projectId: string): Promise<ProjectPlan> {
  const response = await fetch(`/api/projects/${projectId}/plan`);
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Kunde inte hämta projektplan');
  }
  const data = await response.json();
  return data.plan;
}

export async function saveProjectPlan(projectId: string, plan: ProjectPlan): Promise<void> {
  const response = await fetch(`/api/projects/${projectId}/plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ plan }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Kunde inte spara projektplan');
  }
}

export async function applyTemplate(
  projectId: string,
  templateId: string,
  plan: ProjectPlan,
): Promise<ProjectPlan> {
  const response = await fetch(`/api/projects/${projectId}/template/apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ templateId, plan }),
  });
  if (!response.ok) throw new Error('Kunde inte applicera mall');
  const data = await response.json();
  return data.plan;
}

export async function evaluateStageGate(
  projectId: string,
  gateId: string,
  context: Record<string, unknown>,
): Promise<{ plan: ProjectPlan; changed: boolean; status: string }> {
  const response = await fetch(`/api/projects/${projectId}/stage-gates/${gateId}/evaluate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(context),
  });
  if (!response.ok) throw new Error('Gate-utvärdering misslyckades');
  const data = await response.json();
  return {
    plan: data.plan,
    changed: data.changed,
    status: data.gate?.status || 'PENDING',
  };
}

export async function calculateCarbon(
  projectId: string,
  carbonInput: Record<string, unknown>,
  plan: ProjectPlan,
): Promise<ProjectPlan> {
  const response = await fetch(`/api/projects/${projectId}/carbon/calculate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ carbonInput, plan }),
  });
  if (!response.ok) throw new Error('CO2-kalkyl misslyckades');
  const data = await response.json();
  return data.plan;
}
