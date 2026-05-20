/**
 * AdminPage – Test-sida för admin-gränssnittet
 * Kan monteras direkt eller integreras i router
 *
 * Användning:
 * import AdminPage from 'components/AdminPage';
 * <Route path="/admin" element={<AdminPage />} />
 */

import React from 'react';
import AdminContainer from './admin/AdminContainer';

const AdminPage: React.FC = () => {
  return <AdminContainer />;
};

export default AdminPage;
