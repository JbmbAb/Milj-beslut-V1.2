import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
    const user = await prisma.user.findFirst({ select: { id: true } });
    const project = await prisma.project.findFirst({ select: { id: true } });
    console.log(JSON.stringify({ user: user?.id, project: project?.id }, null, 2));
}

main().finally(() => prisma.$disconnect());
