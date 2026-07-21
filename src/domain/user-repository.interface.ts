import { AuthUser } from './auth';

export interface IUserRepository {
  findByBankId(bankidId: string): Promise<AuthUser | null>;
  ensureMockUser(bankidId: string): Promise<AuthUser>;
}
