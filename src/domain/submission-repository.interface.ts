import { Submission, SubmissionArtifact, SubmissionStatusEvent } from './submission';

export interface ISubmissionRepository {
  findById(id: string): Promise<Submission | null>;
  findByKey(submissionKey: string, organisationId?: string): Promise<Submission | null>;
  findByProject(projectId: string): Promise<Submission[]>;
  save(submission: Submission): Promise<Submission>;
  addArtifact(artifact: Omit<SubmissionArtifact, 'id'>): Promise<SubmissionArtifact>;
  logStatusEvent(event: Omit<SubmissionStatusEvent, 'id'>): Promise<SubmissionStatusEvent>;
  getSubmissionWithEvents(
    id: string,
  ): Promise<Submission & { events: SubmissionStatusEvent[]; artifacts: SubmissionArtifact[] }>;
}
