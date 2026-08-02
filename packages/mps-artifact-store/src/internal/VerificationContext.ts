import { RepositoryServices, RepositoryPolicies } from './RepositoryBuilder.js';

export class VerificationContext {
  constructor(
    readonly services: RepositoryServices,
    readonly policies: RepositoryPolicies
  ) {}
}