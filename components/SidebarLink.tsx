import React from 'react';

export const SidebarLink: React.FC<{
  active: boolean;
  icon: string;
  label: string;
  onClick: () => void;
  testId?: string;
}> = ({ active, icon, label, onClick, testId }) => (
  <button
    type="button"
    data-testid={testId}
    onClick={onClick}
    title={icon}
    className={`w-[226px] h-[35px] flex items-center gap-[10px] px-[10px] rounded-[10px] transition-all duration-200 text-left ${
      active ? 'bg-[#29334a] text-[#e0ebf7]' : 'bg-[#1f2633] text-[#e0ebf7] hover:bg-[#273042]'
    }`}
  >
    <span className={`h-2 w-2 rounded-full ${active ? 'bg-[#1d77ff]' : 'bg-[#6f86a5]'}`} />
    <span className="text-[12px] font-semibold tracking-tight truncate">{label}</span>
  </button>
);
