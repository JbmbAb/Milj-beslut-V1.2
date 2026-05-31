import React from 'react';
import type { MetaFunction } from '@remix-run/node';
import { DossierDashboard } from '../../components/DossierDashboard';

// eslint-disable-next-line react-refresh/only-export-components
export const meta: MetaFunction = () => {
  return [
    { title: 'Miljöbeslut.se - Fastighetsdossier' },
    { name: 'description', content: 'AI-driven fastighetsanalys och miljöbedömning.' },
  ];
};

export default function DashboardPage() {
  return <DossierDashboard />;
}
