import { prisma } from '../../../db/prisma';

export async function getSubmissionOrgAndProjectByKey(submissionKey: string): Promise<{
  projectId: string;
  organisationId: string;
} | null> {
  const submission = await prisma.submission.findUnique({
    where: { submissionKey },
    select: { projectId: true, organisationId: true },
  });
  return submission;
}
