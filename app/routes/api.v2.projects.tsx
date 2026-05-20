import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from '@remix-run/node';
import { ProjectController } from '../../src/api/project.controller';

// Vi instansierar kontrollern (singleton-liknande i denna route)
const projectController = new ProjectController();

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const projectId = url.searchParams.get('projectId');

  if (!projectId) {
    return json({ error: 'Missing projectId' }, { status: 400 });
  }

  try {
    const auditTrail = await projectController.getAuditTrail(projectId);
    return json({ auditTrail });
  } catch (error: any) {
    return json({ error: error.message }, { status: 500 });
  }
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, { status: 405 });
  }

  // I en riktig app hämtas userId från session/auth
  const mockUserId = 'user_123456';

  try {
    const body = await request.json();
    const project = await projectController.create(body, mockUserId);
    return json({ project }, { status: 201 });
  } catch (error: any) {
    return json({ error: error.errors || error.message }, { status: 400 });
  }
}
