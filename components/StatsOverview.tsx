import React from 'react';
import { Stats } from '../types';

interface StatsOverviewProps {
  stats: Stats;
}

const StatsOverview: React.FC<StatsOverviewProps> = ({ stats }) => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
      <StatCard
        title="Totalt antal tillstånd"
        value={stats.total}
        icon="fa-file-contract"
        color="bg-blue-500"
      />
      <StatCard title="Beviljade (BIFALL)" value={stats.bifall} icon="fa-check-circle" color="bg-green-500" />
      <StatCard title="Avslagna (AVSLAG)" value={stats.avslag} icon="fa-times-circle" color="bg-red-500" />
      <StatCard title="Kommuner" value={stats.municipalities} icon="fa-city" color="bg-purple-500" />
    </div>
  );
};

const StatCard: React.FC<{ title: string; value: number | string; icon: string; color: string }> = ({
  title,
  value,
  icon,
  color,
}) => (
  <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-6 flex items-center">
    <div className={`${color} w-12 h-12 rounded-lg flex items-center justify-center text-white mr-4`}>
      <i className={`fas ${icon} text-xl`}></i>
    </div>
    <div>
      <p className="text-sm font-medium text-slate-500 uppercase tracking-wider">{title}</p>
      <h3 className="text-2xl font-bold text-slate-800">{value}</h3>
    </div>
  </div>
);

export default StatsOverview;
