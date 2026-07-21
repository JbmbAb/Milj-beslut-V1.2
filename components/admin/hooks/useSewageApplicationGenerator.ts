/**
 * useSewageApplicationGenerator Hook
 * Canonical API: /api/sewage/applications/*
 */

import { useMutation } from '@tanstack/react-query';
import type { SewageApplication, SewageGISAnalysis, SewageProtectionProfile } from '../../../types';

export interface UseSewageApplicationGeneratorOptions {
  onSuccess?: (data: { application: SewageApplication }) => void;
  onError?: (error: Error) => void;
}

/**
 * Mutation to create sewage application
 */
export function useSewageApplicationCreate(options?: UseSewageApplicationGeneratorOptions) {
  return useMutation({
    mutationFn: async (params: {
      projectId: string;
      propertyDesignation: string;
      municipalityCode: string;
      pe: number;
      gisAnalysis: SewageGISAnalysis;
      protectionProfile: SewageProtectionProfile;
      applicantName?: string;
      applicantEmail?: string;
    }) => {
      const response = await fetch('/api/sewage/applications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          propertyDesignation: params.propertyDesignation,
          latitude: params.gisAnalysis.sguBrunnarData.nearestOwnWell?.coordinates.lat ?? 59.33,
          longitude: params.gisAnalysis.sguBrunnarData.nearestOwnWell?.coordinates.lng ?? 18.07,
          applicantName: params.applicantName ?? 'Sökande',
          applicantEmail: params.applicantEmail ?? 'sokande@miljobeslut.se',
          systemType: params.protectionProfile.recommendedSystem,
          projectId: params.projectId,
          municipalityCode: params.municipalityCode,
          pe: params.pe,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to create application');
      }

      return await response.json();
    },
    onSuccess: (data) => {
      options?.onSuccess?.({ application: data.application });
    },
    onError: (error: Error) => {
      options?.onError?.(error);
    },
  });
}

/**
 * Mutation to validate application
 */
export function useSewageApplicationValidate(_options?: UseSewageApplicationGeneratorOptions) {
  return useMutation({
    mutationFn: async (params: {
      applicationId: string;
      application: SewageApplication;
      protectionProfile: SewageProtectionProfile;
    }) => {
      const response = await fetch(`/api/sewage/applications/${params.applicationId}/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          application: params.application,
          protectionProfile: params.protectionProfile,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Validation failed');
      }

      return await response.json();
    },
  });
}

/**
 * Mutation to generate documents
 */
export function useSewageDocumentGenerator(_options?: UseSewageApplicationGeneratorOptions) {
  return useMutation({
    mutationFn: async (params: {
      applicationId: string;
      application: SewageApplication;
      gisAnalysis: SewageGISAnalysis;
      protectionProfile: SewageProtectionProfile;
      applicantName: string;
      applicantEmail: string;
      latitude: number;
      longitude: number;
    }) => {
      const response = await fetch(`/api/sewage/applications/${params.applicationId}/generate-documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Document generation failed');
      }

      return await response.json();
    },
  });
}

/**
 * Mutation to submit application to municipality
 */
export function useSewageApplicationSubmit(options?: UseSewageApplicationGeneratorOptions) {
  return useMutation({
    mutationFn: async (params: {
      applicationId: string;
      application: SewageApplication;
      municipalityCode: string;
      projectId?: string;
    }) => {
      const response = await fetch(`/api/sewage/applications/${params.applicationId}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          application: params.application,
          municipalityCode: params.municipalityCode,
          projectId: params.projectId ?? params.application.projectId,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Submission failed');
      }

      return await response.json();
    },
    onSuccess: (data) => {
      options?.onSuccess?.({ application: data.application });
    },
    onError: (error: Error) => {
      options?.onError?.(error);
    },
  });
}

/**
 * Mutation to record soil test
 */
export function useSewageSoilTestRecord(_options?: UseSewageApplicationGeneratorOptions) {
  return useMutation({
    mutationFn: async (params: {
      applicationId: string;
      ltar: number;
      testDate: string;
      percolationProveReference?: string;
    }) => {
      const legacy = await fetch(`/api/sewage/application/${params.applicationId}/update-soil-test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ltar: params.ltar,
          testDate: params.testDate,
        }),
      });

      if (!legacy.ok) {
        const error = await legacy.json();
        throw new Error(error.error || 'Soil test update failed');
      }

      return await legacy.json();
    },
  });
}

/**
 * Mutation to record neighbor consent
 */
export function useSewageNeighborConsent(_options?: UseSewageApplicationGeneratorOptions) {
  return useMutation({
    mutationFn: async (params: {
      applicationId: string;
      neighborName: string;
      neighborAddress: string;
      distance: number;
      consentDate: string;
    }) => {
      const response = await fetch(
        `/api/sewage/application/${params.applicationId}/record-neighbor-consent`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(params),
        },
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Neighbor consent recording failed');
      }

      return await response.json();
    },
  });
}
