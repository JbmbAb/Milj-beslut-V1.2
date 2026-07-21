/**
 * Admin Hooks - API Integration
 * Centraliserad export för alla admin-relaterade hooks
 *
 * MIGRATION: All modules migrated to React Query (April 2026)
 * Legacy hooks (non-React Query) - DEPRECATED:
 */
export { useAdminProjects } from './useAdminProjects';
export { useTransportBookings } from './useTransportBookings';
export { useProjectPlan } from './useProjectPlan';
export { useCarbonMetrics } from './useCarbonMetrics';
export { useSelectedProject } from './useSelectedProject';

/**
 * React Query hooks - ACTIVE (used by all modules):
 */
export { useAdminProjectsQuery } from './useAdminProjectsQuery';
export { useTransportBookingsQuery } from './useTransportBookingsQuery';
export { useProjectPlanQuery } from './useProjectPlanQuery';
export { useCarbonMetricsQuery } from './useCarbonMetricsQuery';

/**
 * Pagination:
 */
export { usePaginationState } from './usePaginationState';

/**
 * WebSocket (Real-time updates):
 */
export { useWebSocket } from './useWebSocket';
export { useCarbonWebSocket } from './useCarbonWebSocket';
export { useTransportWebSocket } from './useTransportWebSocket';

/**
 * SEO & Metadata:
 */
export { useAdminPageMeta } from './useAdminPageMeta';

/**
 * Project Plan Generation (AI-driven):
 */
export { useProjectPlanGenerator } from './useProjectPlanGenerator';

/**
 * Logistics Generation (AI-driven):
 */
export { useLogisticsGenerator } from './useLogisticsGenerator';

/**
 * Permit Application Generation (AI-driven):
 */
export { usePermitApplicationGenerator } from './usePermitApplicationGenerator';

/**
 * Green Check Generation (AI-driven, EU compliance):
 */
export { useGreenCheckGenerator } from './useGreenCheckGenerator';
