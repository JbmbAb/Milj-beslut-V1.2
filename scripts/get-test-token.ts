import { createTokenPair } from '../server/security/auth';
import { prisma } from '../server/db/prisma';

async function main() {
  let user = await prisma.user.findFirst({ where: { bankidId: 'test-user-1' } });
  if (!user) {
    const org = await prisma.organisation.findFirst() || await prisma.organisation.create({ data: { name: 'Test Org', orgNumber: '123456-7890' } });
    user = await prisma.user.create({
      data: {
        bankidId: 'test-user-1',
        organisationId: org.id,
        role: 'ADMIN'
      }
    });
  }
  const tokens = createTokenPair(user);
  console.log(tokens.accessToken);
  await prisma.$disconnect();
}

main();
