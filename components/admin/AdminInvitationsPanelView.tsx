import React from 'react';
import OrganizationInvitations from './OrganizationInvitations';

type SecureRequest = <T>(
  path: string,
  method: 'GET' | 'POST',
  payload?: Record<string, unknown>,
) => Promise<T>;

interface AdminInvitationsPanelViewProps {
  organisationId: string;
  secure: SecureRequest;
}

const AdminInvitationsPanelView: React.FC<AdminInvitationsPanelViewProps> = ({ organisationId, secure }) => (
  <section className="space-y-6">
    <div className="flex items-center gap-3">
      <span className="h-2 w-2 rounded-full bg-indigo-600" />
      <h2 className="text-xl font-black uppercase tracking-widest text-slate-800">
        Organisationsinbjudningar
      </h2>
    </div>
    <OrganizationInvitations orgId={organisationId} secure={secure} />
  </section>
);

export default AdminInvitationsPanelView;
