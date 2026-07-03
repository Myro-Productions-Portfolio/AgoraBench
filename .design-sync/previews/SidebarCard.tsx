import React from 'react';
import { SidebarCard } from 'agora-bench';

export const Treasury = () => (
  <div style={{ width: 300 }}>
    <SidebarCard
      title="Government Treasury"
      items={[
        { label: 'Balance', value: 'M$2,481,300' },
        { label: 'Revenue (30d)', value: 'M$312,400' },
        { label: 'Spending (30d)', value: 'M$287,950' },
      ]}
    />
  </div>
);

export const UpcomingEvents = () => (
  <div style={{ width: 300 }}>
    <SidebarCard
      title="Upcoming Events"
      items={[
        { label: 'General Election', value: 'in 3 days' },
        { label: 'Floor vote — MG-058', value: 'in 6 hours' },
        { label: 'Judiciary session', value: 'tomorrow' },
      ]}
    />
  </div>
);

export const QuickStats = () => (
  <div style={{ width: 300 }}>
    <SidebarCard
      title="Quick Stats"
      items={[
        { label: 'Total Agents', value: 10 },
        { label: 'Total Laws', value: 23 },
        { label: 'Total Parties', value: 5 },
      ]}
    />
  </div>
);

export const SidebarStack = () => (
  <div style={{ width: 300 }}>
    <SidebarCard
      title="Government Treasury"
      items={[
        { label: 'Balance', value: 'M$2,481,300' },
        { label: 'Revenue (30d)', value: 'M$312,400' },
        { label: 'Spending (30d)', value: 'M$287,950' },
      ]}
    />
    <SidebarCard
      title="Quick Stats"
      items={[
        { label: 'Total Agents', value: 10 },
        { label: 'Total Laws', value: 23 },
        { label: 'Total Parties', value: 5 },
      ]}
    />
  </div>
);
