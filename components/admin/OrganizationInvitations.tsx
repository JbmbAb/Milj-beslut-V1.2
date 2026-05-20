import React, { useCallback, useEffect, useState } from 'react';
import { LucideMail, LucideUserPlus, LucideTrash2, LucideRefreshCw, LucideClock } from 'lucide-react';

interface Invitation {
  id: string;
  email: string;
  role: string;
  status: 'PENDING' | 'ACCEPTED' | 'EXPIRED' | 'REVOKED';
  expiresAt: string;
  createdAt: string;
}

interface OrganizationInvitationsProps {
  orgId: string;
  secure: <T>(url: string, method: string, body?: any) => Promise<T>;
}

const OrganizationInvitations: React.FC<OrganizationInvitationsProps> = ({ orgId, secure }) => {
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState('CONSULTANT');
  const [success, setSuccess] = useState('');

  const fetchInvitations = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = (await secure(`/api/orgs/${orgId}/invitations`, 'GET')) as {
        ok: true;
        invitations: Invitation[];
      };
      setInvitations(data.invitations);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kunde inte hämta inbjudningar');
    } finally {
      setLoading(false);
    }
  }, [orgId, secure]);

  const handleCreateInvitation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmail) return;
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      await secure(`/api/orgs/${orgId}/invitations`, 'POST', {
        email: newEmail,
        role: newRole,
      });
      setSuccess(`Inbjudan skickad till ${newEmail}`);
      setNewEmail('');
      await fetchInvitations();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kunde inte skapa inbjudan');
    } finally {
      setLoading(false);
    }
  };

  const handleRevoke = async (inviteId: string) => {
    if (!confirm('Är du säker på att du vill återkalla denna inbjudan?')) return;
    setLoading(true);
    try {
      await secure(`/api/orgs/${orgId}/invitations/${inviteId}`, 'DELETE');
      await fetchInvitations();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kunde inte återkalla inbjudan');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (orgId) {
      void fetchInvitations();
    }
  }, [orgId, fetchInvitations]);

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 bg-indigo-50 rounded-lg text-indigo-600">
            <LucideUserPlus size={20} />
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-900">Bjud in nya medarbetare</h3>
            <p className="text-xs text-slate-500 text-pretty">
              Inbjudan skickas via e-post och är giltig i 72 timmar.
            </p>
          </div>
        </div>

        <form onSubmit={handleCreateInvitation} className="flex flex-wrap gap-4">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 px-1">
              E-postadress
            </label>
            <div className="relative">
              <LucideMail className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="namn@foretag.se"
                className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all font-medium"
                required
              />
            </div>
          </div>

          <div className="w-48">
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 px-1">
              Roll
            </label>
            <select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all font-medium"
            >
              <option value="CONSULTANT">Konsult</option>
              <option value="ADMIN">Administratör</option>
              <option value="AUDITOR">Revisor</option>
            </select>
          </div>

          <div className="flex items-end">
            <button
              type="submit"
              disabled={loading || !newEmail}
              className="px-6 py-2 bg-indigo-600 text-white rounded-lg text-sm font-bold hover:bg-indigo-700 transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {loading ? (
                <LucideRefreshCw size={16} className="animate-spin" />
              ) : (
                <LucideUserPlus size={16} />
              )}
              Skicka inbjudan
            </button>
          </div>
        </form>

        {error && (
          <div className="mt-4 p-3 bg-rose-50 border border-rose-100 text-rose-600 text-xs font-bold rounded-lg">
            {error}
          </div>
        )}
        {success && (
          <div className="mt-4 p-3 bg-emerald-50 border border-emerald-100 text-emerald-600 text-xs font-bold rounded-lg">
            {success}
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex justify-between items-center">
          <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            Aktiva inbjudningar
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 font-black">
              {invitations.length}
            </span>
          </h3>
          <button
            onClick={fetchInvitations}
            className="p-2 text-slate-400 hover:text-indigo-600 transition-colors"
          >
            <LucideRefreshCw size={18} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/50">
                <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">
                  E-post
                </th>
                <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">
                  Roll
                </th>
                <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">
                  Status
                </th>
                <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">
                  Går ut
                </th>
                <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 text-right">
                  Åtgärder
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {invitations.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-slate-400 bg-slate-50/20">
                    <LucideClock size={32} className="mx-auto mb-3 opacity-20" />
                    <p className="text-sm font-medium">Inga aktiva inbjudningar hittades.</p>
                  </td>
                </tr>
              ) : (
                invitations.map((invite) => (
                  <tr key={invite.id} className="hover:bg-slate-50/50 transition-colors group">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 text-xs font-bold">
                          {invite.email[0].toUpperCase()}
                        </div>
                        <span className="text-sm font-bold text-slate-700">{invite.email}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 font-black tracking-tight uppercase">
                        {invite.role}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <StatusBadge status={invite.status} />
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-xs text-slate-500 font-medium">
                        {new Date(invite.expiresAt).toLocaleString('sv-SE')}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      {invite.status === 'PENDING' && (
                        <button
                          onClick={() => handleRevoke(invite.id)}
                          className="p-2 text-slate-300 hover:text-rose-600 transition-colors rounded-lg hover:bg-rose-50"
                        >
                          <LucideTrash2 size={16} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

const StatusBadge: React.FC<{ status: Invitation['status'] }> = ({ status }) => {
  const configs = {
    PENDING: { bg: 'bg-amber-50 text-amber-600 border-amber-100', label: 'Väntar' },
    ACCEPTED: { bg: 'bg-emerald-50 text-emerald-600 border-emerald-100', label: 'Accepterad' },
    EXPIRED: { bg: 'bg-slate-50 text-slate-500 border-slate-100', label: 'Utgången' },
    REVOKED: { bg: 'bg-rose-50 text-rose-500 border-rose-100', label: 'Återkallad' },
  };

  const config = configs[status] || configs.PENDING;

  return (
    <span
      className={`text-[10px] px-2 py-0.5 rounded-full border ${config.bg} font-black uppercase tracking-tight`}
    >
      {config.label}
    </span>
  );
};

export default OrganizationInvitations;
